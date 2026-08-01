/**
 * Reads a run's execution record from **LangGraph's own checkpoints** — no bespoke
 * capture channel, no Store side-reads, nothing muffin-specific.
 *
 * `POST /threads/{id}/history` returns one snapshot per superstep. Each carries
 * `metadata.step`, a `created_at`, the `tasks[]` that ran in that superstep, and `next`
 * (what runs after it). Every task has `{id, name, result, error, checkpoint:{checkpoint_ns}}`,
 * and passing that `checkpoint_ns` back to `getHistory` returns the child's own
 * supersteps and *its* tasks — so the whole tree is reachable by recursion, and each
 * namespace's `values.messages` is that node's transcript, tool calls included.
 *
 * ## Supersteps are the unit
 *
 * Everything sharing a `metadata.step` ran **in parallel**; successive steps ran
 * **sequentially**. This module therefore emits `Lane[]`, not a flat node list. The
 * previous version flattened supersteps away, which is why a 10-way fan-out and a
 * 10-step sequence rendered identically.
 *
 * Verified against production (thread `019faada`, criteria_analysis, root namespace):
 *
 * ```
 * step 0  22:31:29  ticker_classification ×1                              → 16m32s
 * step 2  22:48:01  criteria_definition ×1 + valuation_methodology ×1      → PARALLEL, 47s
 * step 4  22:48:48  criterion_evaluation ×10                               → 10-WAY FAN, 4m16s
 * step 5  22:53:04  synthesis ×1                                           → 43s
 * ```
 *
 * and in the `ticker_classification:49942a09-…` namespace: 14 snapshots, `values.todos`
 * appearing at step 5 and evolving, `values.messages` growing 0→1→2→3→4→7→8, and
 * `tasks=['tools','tools','tools']` at step 7 — three parallel sub-agent delegations.
 *
 * **Only nodes that are compiled agents/subgraphs added via `add_node` expose a child
 * namespace.** A plain function node reports `checkpoint: null` — it is genuinely
 * leaf-shaped (verified: `lift_classification` and `merge_criteria` have none).
 *
 * ## Cost
 *
 * One namespace = one API round trip, so rows are fetched on expand and cached
 * indefinitely for a finished thread.
 */
import type { Client, ThreadState } from '@langchain/langgraph-sdk';

import {
  durationBetween,
  humanise,
  iconForNode,
  isInternalNode,
  type Lane,
  type RunNode,
  type RunStatus,
} from './run-node';
import { parseArray, zToolRun, type ToolRun } from './schemas';

/** How many supersteps to pull per namespace. Deep enough for the graphs muffin
 * runs (the busiest namespace observed in production used 14); the tasks we care
 * about appear across the whole window, so this is a real ceiling rather than a page
 * size we paginate through. */
const HISTORY_LIMIT = 40;

export type HistorySnapshot = ThreadState<Record<string, unknown>>;

/** Fetch one namespace's supersteps. `undefined` namespace = the root graph. */
export async function fetchNamespace(
  client: Client,
  threadId: string,
  checkpointNs?: string,
  limit = HISTORY_LIMIT,
): Promise<HistorySnapshot[]> {
  return (await client.threads.getHistory(threadId, {
    limit,
    ...(checkpointNs ? { checkpoint: { checkpoint_ns: checkpointNs } } : {}),
  })) as HistorySnapshot[];
}

type RawMessage = {
  type?: string;
  role?: string;
  name?: string;
  status?: string;
  content?: unknown;
  tool_calls?: { id?: string; name?: string; args?: unknown }[];
  tool_call_id?: string;
  /** `ToolResultCacheMiddleware` stamps this on every cacheable tool result. */
  additional_kwargs?: {
    cache?: { hit?: boolean; args_hash?: string; byte_size?: number };
  };
};

/** `<parent>|<node>:<task id>` — how LangGraph composes a child namespace. */
function childNamespace(parent: string | undefined, node: string, taskId: string): string {
  const segment = `${node}:${taskId}`;
  return parent ? `${parent}|${segment}` : segment;
}

/** Oldest-first. `getHistory` returns newest-first; execution order is the reverse. */
function inExecutionOrder(snapshots: HistorySnapshot[]): HistorySnapshot[] {
  return [...snapshots].reverse();
}

function stepOf(snap: HistorySnapshot): number {
  const step = (snap.metadata as { step?: unknown } | undefined)?.step;
  return typeof step === 'number' ? step : -1;
}

/**
 * Which tasks spawned a deep-agent sub-agent, and which sub-agent.
 *
 * A `task` tool call names its target in `args.subagent_type`; the matching
 * `ToolMessage` tells us which tools-node task actually ran it. Pairing the two turns
 * an anonymous "Tools" step into a named sub-agent row.
 *
 * Their checkpoints are only readable because muffin-agent pins a deepagents fork —
 * upstream documents tool-invoked subgraphs as not statically discoverable, so
 * `POST /history` on these namespaces 400s without it.
 */
type Delegation = { name: string; input?: string; callId: string };

function taskDelegations(snapshots: HistorySnapshot[]): Map<string, Delegation> {
  const callById = new Map<string, Delegation>();
  for (const snap of snapshots) {
    for (const task of snap.tasks ?? []) {
      const written = (task.result as { messages?: unknown } | undefined)?.messages;
      for (const m of (Array.isArray(written) ? written : []) as RawMessage[]) {
        for (const call of m?.tool_calls ?? []) {
          const args = call.args as { subagent_type?: unknown; description?: unknown } | undefined;
          if (call.id && call.name === 'task' && typeof args?.subagent_type === 'string') {
            callById.set(call.id, {
              name: args.subagent_type,
              // The brief the parent handed down — the sub-agent's Input facet.
              input: typeof args.description === 'string' ? args.description : undefined,
              callId: call.id,
            });
          }
        }
      }
    }
  }

  const byTaskId = new Map<string, Delegation>();
  for (const snap of snapshots) {
    for (const task of snap.tasks ?? []) {
      if (!task?.id) continue;
      const written = (task.result as { messages?: unknown } | undefined)?.messages;
      for (const m of (Array.isArray(written) ? written : []) as RawMessage[]) {
        const isToolMessage = m?.type === 'tool' || m?.role === 'tool';
        const target = isToolMessage && m.tool_call_id ? callById.get(m.tool_call_id) : undefined;
        if (target) byTaskId.set(task.id, target);
      }
    }
  }
  return byTaskId;
}

/**
 * Pull one channel's value out of a task's `result`.
 *
 * A task result is a map of the channels it wrote. Repeated writes to one channel are
 * aggregated by LangGraph into `{$writes: [...]}`, and a reducer channel's write is
 * usually a single-element list, so this unwraps both and returns the first value.
 */
export function taskWrite(result: unknown, channel: string): unknown {
  if (!result || typeof result !== 'object') return undefined;
  let value = (result as Record<string, unknown>)[channel];
  if (value && typeof value === 'object' && '$writes' in value) {
    value = (value as { $writes?: unknown[] }).$writes?.[0];
  }
  return Array.isArray(value) ? value[0] : value;
}

/** The channels a task wrote — the keys of its `result` (verified: `criterion_evaluation`
 * → `['criterion_evaluations']`, `synthesis` → `['synthesis']`). `metadata.writes` looks
 * like it should serve here but comes back **empty** over the API, so `result` is the
 * only source. */
function resultChannels(result: unknown): string[] {
  return result && typeof result === 'object' && !Array.isArray(result)
    ? Object.keys(result as Record<string, unknown>)
    : [];
}

/**
 * A display label for one member of a parallel fan-out, from its own payload.
 *
 * Every worker in a fan-out is the same graph node, so the raw topology gives N
 * identical labels ("Criterion evaluation" ×10). Each task's `result` carries the
 * channel it wrote, so the worker's own name is available from the PARENT history
 * without fetching each namespace.
 *
 * The field probe is generic — `criterion_name` for a criteria worker, `agent_id` for a
 * council persona — rather than a per-graph rule, so a future fan-out labels itself for
 * free if its payload names itself at all.
 *
 * Deliberately **not** index-paired against the parent's aggregated channel: parallel
 * `Send` workers complete out of order, so labels would silently drift onto wrong rows.
 *
 * **Applied ONLY to fan-out members** (`relabelFanOut`). Run against every node it
 * misfires on any node whose payload happens to be a named list: `merge_criteria`
 * writes `merged_criteria`, `taskWrite` unwraps the array to its first element, and the
 * step rendered as "Revenue Growth (3Y CAGR)" — the name of a criterion it merely
 * collected. Verified on thread `019faada` before the guard existed.
 */
const LABEL_FIELDS = ['criterion_name', 'name', 'title', 'label', 'agent_id', 'id'];

function labelFromResult(result: unknown, channels: string[]): string | undefined {
  for (const channel of channels) {
    const written = taskWrite(result, channel);
    if (!written || typeof written !== 'object' || Array.isArray(written)) continue;
    for (const field of LABEL_FIELDS) {
      const v = (written as Record<string, unknown>)[field];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return undefined;
}

/**
 * Give each member of a same-node fan-out its own name.
 *
 * Only nodes that are genuinely indistinguishable — two or more in ONE superstep
 * sharing a graph node name — are relabelled, and only if every one of them yields a
 * name (a partial relabel would read as an inconsistent list rather than a fan).
 */
function relabelFanOut(nodes: RunNode[]): void {
  const byName = new Map<string, RunNode[]>();
  for (const node of nodes) {
    const peers = byName.get(node.name);
    if (peers) peers.push(node);
    else byName.set(node.name, [node]);
  }
  for (const peers of byName.values()) {
    if (peers.length < 2) continue;
    const labels = peers.map((n) => labelFromResult(n.output, resultChannels(n.output)));
    if (labels.some((l) => !l)) continue;
    peers.forEach((n, i) => (n.label = labels[i] as string));
  }
}

/**
 * The lanes that ran inside one namespace, in execution order.
 *
 * `busy` marks the newest superstep's tasks `active` rather than `done` — history alone
 * cannot distinguish "finished" from "still running", which is why the previous model
 * could never render a running node.
 */
export function lanesFromSnapshots(
  snapshots: HistorySnapshot[],
  parentNamespace?: string,
  busy = false,
): Lane[] {
  const ordered = inExecutionOrder(snapshots);
  const delegations = taskDelegations(snapshots);
  const lanes: Lane[] = [];
  /** Task ids already emitted — a task pending in one superstep can reappear in the
   * next, and must not become a second lane. */
  const seen = new Map<string, RunNode>();

  ordered.forEach((snap, i) => {
    const step = stepOf(snap);
    const startedAt = snap.created_at ?? undefined;
    // End of this superstep = start of the next SNAPSHOT (not the next surviving lane):
    // supersteps we filter out still consumed wall-clock.
    const endedAt = ordered[i + 1]?.created_at ?? undefined;
    const durationMs = durationBetween(startedAt, endedAt);
    const isNewest = i === ordered.length - 1;

    const nodes: RunNode[] = [];
    for (const task of snap.tasks ?? []) {
      if (!task?.id) continue;

      const existing = seen.get(task.id);
      if (existing) {
        // A later snapshot may carry the error or result an earlier one lacked.
        if (task.error) existing.status = 'error';
        if (task.result != null && existing.output == null) existing.output = task.result;
        continue;
      }

      const status: RunStatus = task.error ? 'error' : isNewest && busy ? 'active' : 'done';

      // A `tools` task that ran a deep-agent `task` delegation IS an execution step —
      // the sub-agent it spawned. Every other `tools`/`model` task is ReAct-loop
      // plumbing whose work is already in the transcript.
      const delegated = delegations.get(task.id);
      if (delegated) {
        // Derived, not reported: a ToolNode task has `checkpoint: null`, but the
        // sub-agent checkpoints under `<parent>|<node>:<task id>` — the same `name:id`
        // shape LangGraph builds namespaces from.
        const ns = childNamespace(parentNamespace, task.name ?? 'tools', task.id);
        const node: RunNode = {
          id: ns,
          name: delegated.name,
          label: humanise(delegated.name),
          icon: 'agents',
          status,
          step,
          startedAt,
          endedAt,
          durationMs,
          namespace: ns,
          input: delegated.input,
          toolCallId: delegated.callId,
        };
        seen.set(task.id, node);
        nodes.push(node);
        continue;
      }

      if (isInternalNode(task.name ?? '')) continue;

      const namespace = task.checkpoint?.checkpoint_ns || undefined;
      const channels = resultChannels(task.result);
      const node: RunNode = {
        id: namespace ?? `${task.name}:${task.id}`,
        name: task.name ?? 'step',
        // Fan-out members are renamed from their own payloads once the lane is
        // complete — see `relabelFanOut`, which needs to see the peers first.
        label: humanise(task.name ?? 'step'),
        icon: iconForNode(task.name ?? ''),
        status,
        step,
        startedAt,
        endedAt,
        durationMs,
        namespace,
        // Only when unambiguous. A node writing several channels has no single
        // "output" — the renderer scans the payload instead of us guessing here.
        outputChannel: channels.length === 1 ? channels[0] : undefined,
        // The task's own channel writes — available WITHOUT fetching its namespace.
        output: task.result ?? undefined,
      };
      seen.set(task.id, node);
      nodes.push(node);
    }

    if (nodes.length === 0) return; // a pure-middleware superstep
    if (nodes.length > 1) relabelFanOut(nodes);
    lanes.push({ step, parallel: nodes.length > 1, startedAt, durationMs, nodes });
  });

  return lanes;
}

/**
 * The node names LangGraph says will run next (`next` on the newest snapshot).
 *
 * This is what finally lets the timeline show `pending` honestly — the previous model
 * never read `next`, so a node that had not run yet simply did not exist in the UI.
 * Empty for a finished run (verified: thread `019faada` step 6 has `next: []`).
 */
export function pendingFromSnapshots(snapshots: HistorySnapshot[]): string[] {
  // getHistory is newest-first, so the head is the current state.
  const next = snapshots[0]?.next ?? [];
  return next.filter((name) => !isInternalNode(name));
}

export type PlanSnapshot = { step: number; todos: unknown[] };

/**
 * A deep agent's plan at each superstep where it CHANGED.
 *
 * `TodoListMiddleware` keeps the list in the agent's own `values.todos`, and it is
 * excluded from what a sub-agent writes back, so this is per-namespace by construction.
 * Returning the successive states (rather than one final list) is what lets the UI show
 * the plan evolving, which is how the run actually felt to the agent.
 *
 * Verified: `ticker_classification:49942a09-…` has no todos until step 5, then carries
 * 4 items (`{content, status}`) that re-render as their statuses advance.
 */
export function planFromSnapshots(snapshots: HistorySnapshot[]): PlanSnapshot[] {
  const out: PlanSnapshot[] = [];
  let previous = '';
  for (const snap of inExecutionOrder(snapshots)) {
    const todos = (snap.values as { todos?: unknown } | undefined)?.todos;
    if (!Array.isArray(todos) || todos.length === 0) continue;
    const key = JSON.stringify(todos);
    if (key === previous) continue;
    previous = key;
    out.push({ step: stepOf(snap), todos });
  }
  return out;
}

export type TranscriptSlice = { step: number; messages: unknown[] };

/**
 * The transcript, split into the supersteps that produced it.
 *
 * A namespace's `values.messages` only ever grows (verified: 0→1→2→3→4→7→8 across the
 * `ticker_classification` namespace), so the messages new at superstep N are the ones
 * that node produced in step N. That is the merge key that lets the UI interleave
 * transcript turns, child node runs and plan updates into ONE ordered timeline instead
 * of stacking three separate panels.
 *
 * A shrinking array means the history was rewritten (context summarisation), so the
 * baseline resets and the whole current array is attributed to that step rather than
 * reporting a negative slice.
 */
export function transcriptByStep(snapshots: HistorySnapshot[]): TranscriptSlice[] {
  const out: TranscriptSlice[] = [];
  let consumed = 0;
  for (const snap of inExecutionOrder(snapshots)) {
    const msgs = (snap.values as { messages?: unknown } | undefined)?.messages;
    if (!Array.isArray(msgs)) continue;
    if (msgs.length < consumed) consumed = 0; // rewritten — restart the accounting
    if (msgs.length === consumed) continue;
    out.push({ step: stepOf(snap), messages: msgs.slice(consumed) });
    consumed = msgs.length;
  }
  return out;
}

/**
 * The messages a namespace recorded — its transcript, tool calls included.
 *
 * Read straight from the channel. This briefly went through a reconstruction from
 * `tasks[].result.messages`, because every DEEP agent reported `values.messages == []`
 * while its tasks had demonstrably run model turns and tool calls. That was an upstream
 * bug, not a fact about deep agents: `_prepare_state_snapshot` hydrated channels with
 * `self.checkpointer` alone, but a subgraph from `get_subgraphs()` is compiled without
 * one, so `DeltaChannel`s (which is what an agent's `messages` is) had no saver to
 * replay their ancestor writes and silently came back empty.
 *
 * Fixed in langchain-ai/langgraph#8470, which muffin-agent pins a fork for until it
 * ships. The reconstruction is deliberately NOT kept as a fallback: it would mask a
 * regression if that pin were ever dropped too early, and reading one authoritative
 * source beats silently choosing between two.
 */
export function messagesFromSnapshots(snapshots: HistorySnapshot[]): unknown[] {
  let best: unknown[] = [];
  for (const snap of snapshots) {
    const msgs = (snap.values as { messages?: unknown })?.messages;
    if (Array.isArray(msgs) && msgs.length > best.length) best = msgs;
  }
  return best;
}

/** The richest `values` a namespace recorded, for rendering its structured output. */
export function latestValues(snapshots: HistorySnapshot[]): Record<string, unknown> {
  // getHistory is newest-first, so the first snapshot with values wins.
  for (const snap of snapshots) {
    if (snap.values && Object.keys(snap.values).length > 0) return snap.values;
  }
  return {};
}

/** The first human message in a namespace — the prompt this node was handed. */
export function inputFromMessages(messages: unknown[]): string | undefined {
  for (const m of messages as RawMessage[]) {
    if (m?.type === 'human' || m?.role === 'user') {
      const text = messageText(m.content);
      if (text?.trim()) return text;
    }
  }
  return undefined;
}

function messageText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((b) => (typeof b === 'string' ? b : ((b as { text?: string })?.text ?? '')))
    .join('');
  return text || undefined;
}

/**
 * Reconstruct tool-execution records from a namespace's transcript.
 *
 * A tool call is already a first-class part of the message history — an
 * `AIMessage.tool_calls` entry paired with the `ToolMessage` carrying its result — so
 * this reads the same thing LangGraph persisted rather than a parallel record the
 * backend had to maintain in graph state.
 *
 * A call with no matching `ToolMessage` is still reported (status `pending`): the run
 * may have been cancelled mid-call, and silently dropping it would hide that.
 *
 * **Field names are the panel's contract, not ours.** The rows read
 * `args_preview` / `output_preview` / `error`. Emitting `args`/`output` instead left
 * successful calls rendering blank while errors rendered fine — `error` was the one name
 * that happened to match. `zToolRun` is a `looseObject`, so the wrong keys passed
 * validation silently.
 *
 * `output_preview` carries the **full** content, not a preview. The name is historical:
 * the old capture channel capped it because it lived in graph state. Read from the
 * transcript on demand there is no storage cost, so charts and JSON render in full —
 * which is why the timeline needs no Store lookup to show a tool's output.
 */
export function toolRunsFromMessages(messages: unknown[], agent?: string): ToolRun[] {
  const results = new Map<string, RawMessage>();
  for (const m of messages as RawMessage[]) {
    const isToolMessage = m?.type === 'tool' || m?.role === 'tool';
    if (isToolMessage && m.tool_call_id) results.set(m.tool_call_id, m);
  }

  const runs: Record<string, unknown>[] = [];
  for (const m of messages as RawMessage[]) {
    for (const call of m?.tool_calls ?? []) {
      const result = call.id ? results.get(call.id) : undefined;
      // `status` on a ToolMessage is LangChain's own success/error flag.
      const status = !result ? 'pending' : result.status === 'error' ? 'error' : 'ok';
      const text = result ? messageText(result.content) : undefined;
      const cache = result?.additional_kwargs?.cache;
      runs.push({
        tool: call.name,
        agent,
        // Renders the row as "delegated to subagent" rather than a bare `task`.
        is_subagent_call: call.name === 'task',
        status,
        args_hash: cache?.args_hash,
        cache_hit: cache?.hit,
        // Stringified so the row's `tryParse` can render it as a JSON block instead of
        // one long line of text.
        args_preview: call.args === undefined ? '' : JSON.stringify(call.args),
        // Errors carry their content in `error`; keeping it out of the output slot
        // stops the same text rendering twice.
        output_preview: status === 'error' ? '' : (text ?? ''),
        error: status === 'error' ? text : undefined,
      });
    }
  }
  // Validated at the boundary like every other backend-shaped payload.
  return parseArray(zToolRun, runs, 'history.tool_runs');
}
