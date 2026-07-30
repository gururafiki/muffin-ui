/**
 * Reads a past run's execution tree from **LangGraph's own checkpoints** — no bespoke
 * capture channel involved.
 *
 * `POST /threads/{id}/history` returns one snapshot per superstep, each carrying the
 * `tasks[]` that ran in it. Every task has `{id, name, result, checkpoint:{checkpoint_ns}}`,
 * and passing that `checkpoint_ns` back to `getHistory` returns the child's own
 * supersteps and *its* tasks. So the whole tree is reachable by recursion, and each
 * namespace's `values.messages` is that node's transcript — including its tool calls.
 *
 * Verified against production: namespace `market_analyst:<uuid>` on thread 019f81a0
 * returns 13 messages (1 human / 2 ai / 10 tool) with 10 real tool calls.
 *
 * **Only nodes that are compiled agents/subgraphs added via `add_node` expose a child
 * namespace.** A plain function node reports `checkpoint: null` — it is genuinely
 * leaf-shaped. See muffin-agent's graph-authoring rule.
 *
 * ## Cost
 *
 * One namespace = one API round trip, so rows are fetched on expand and cached
 * indefinitely for a finished thread. Reads used to take 5–28 s; that turned out to be
 * uncached MCP tool discovery during the per-request graph rebuild, not the
 * checkpointer, and is fixed in muffin-agent (`2026-07-27-api-read-latency-mcp-tool-discovery.md`).
 */
import type { Client, ThreadState } from '@langchain/langgraph-sdk';

import { humanise, isInternalNode, type ExecNode } from './exec-tree';
import { parseArray, zToolRun, type ToolRun } from './schemas';

/** How many supersteps to pull per namespace. Deep enough for the graphs muffin
 * runs; the tasks we care about appear across the whole window, so this is a real
 * ceiling rather than a page size we paginate through. */
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

/**
 * Which tasks spawned a deep-agent sub-agent, and which sub-agent.
 *
 * A `task` tool call names its target in `args.subagent_type`; the matching
 * `ToolMessage` tells us which tools-node task actually ran it. Pairing the two
 * turns an anonymous "Tools" step into a named sub-agent row.
 *
 * Their checkpoints are only readable because muffin-agent pins a deepagents
 * fork — upstream documents tool-invoked subgraphs as not statically
 * discoverable, so `POST /history` on these namespaces 400s without it.
 */
function taskDelegations(snapshots: HistorySnapshot[]): Map<string, string> {
  const subagentByCallId = new Map<string, string>();
  for (const snap of snapshots) {
    for (const task of snap.tasks ?? []) {
      const written = (task.result as { messages?: unknown } | undefined)?.messages;
      for (const m of (Array.isArray(written) ? written : []) as RawMessage[]) {
        for (const call of m?.tool_calls ?? []) {
          const type = (call.args as { subagent_type?: unknown } | undefined)?.subagent_type;
          if (call.id && call.name === 'task' && typeof type === 'string') {
            subagentByCallId.set(call.id, type);
          }
        }
      }
    }
  }

  const byTaskId = new Map<string, string>();
  for (const snap of snapshots) {
    for (const task of snap.tasks ?? []) {
      if (!task?.id) continue;
      const written = (task.result as { messages?: unknown } | undefined)?.messages;
      for (const m of (Array.isArray(written) ? written : []) as RawMessage[]) {
        const isToolMessage = m?.type === 'tool' || m?.role === 'tool';
        const target = isToolMessage && m.tool_call_id
          ? subagentByCallId.get(m.tool_call_id)
          : undefined;
        if (target) byTaskId.set(task.id, target);
      }
    }
  }
  return byTaskId;
}

/**
 * The child nodes that ran inside one namespace, in execution order.
 *
 * Tasks repeat across snapshots (a task pending in step N appears again in N+1), so
 * they are de-duplicated by task id, and a later snapshot may carry the result or
 * error an earlier one lacked.
 */
export function nodesFromSnapshots(
  snapshots: HistorySnapshot[],
  parentNamespace?: string,
): ExecNode[] {
  const seen = new Map<string, ExecNode>();
  const delegations = taskDelegations(snapshots);
  // getHistory returns newest-first; execution order is the reverse.
  for (const snap of [...snapshots].reverse()) {
    for (const task of snap.tasks ?? []) {
      if (!task?.id) continue;
      // A `tools` task that ran a deep-agent `task` delegation IS an execution
      // step — the sub-agent it spawned. Every other `tools`/`model` task is
      // ReAct-loop plumbing whose work is already in the transcript.
      const delegatedTo = delegations.get(task.id);
      if (delegatedTo) {
        if (seen.has(task.id)) continue;
        seen.set(task.id, {
          // Derived, not reported: a ToolNode task has `checkpoint: null`, but
          // the sub-agent checkpoints under `<parent>|<node>:<task id>` — the
          // same `name:id` shape LangGraph builds namespaces from.
          id: childNamespace(parentNamespace, task.name ?? 'tools', task.id),
          label: humanise(delegatedTo),
          name: delegatedTo,
          kind: 'agent',
          status: task.error ? 'error' : 'done',
          namespace: childNamespace(parentNamespace, task.name ?? 'tools', task.id),
          children: [],
        });
        continue;
      }
      if (isInternalNode(task.name ?? '')) continue;
      const existing = seen.get(task.id);
      if (existing) {
        if (task.error) existing.status = 'error';
        if (task.result != null && existing.output == null) existing.output = task.result;
        continue;
      }
      const namespace = task.checkpoint?.checkpoint_ns || undefined;
      seen.set(task.id, {
        id: namespace ?? `${task.name}:${task.id}`,
        label: humanise(task.name ?? 'step'),
        name: task.name,
        kind: 'agent',
        status: task.error ? 'error' : 'done',
        // The task's own channel writes — available WITHOUT fetching its namespace,
        // which is what lets a fan-out row be labelled by its result rather than by
        // an indistinguishable node name ("Criterion evaluation" × 11).
        output: task.result ?? undefined,
        namespace,
        children: [],
      });
    }
  }
  return [...seen.values()];
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

/**
 * The messages a namespace recorded — its transcript, tool calls included.
 *
 * Read straight from the channel. This briefly went through a reconstruction
 * from `tasks[].result.messages`, because every DEEP agent reported
 * `values.messages == []` while its tasks had demonstrably run model turns and
 * tool calls. That was an upstream bug, not a fact about deep agents:
 * `_prepare_state_snapshot` hydrated channels with `self.checkpointer` alone,
 * but a subgraph from `get_subgraphs()` is compiled without one, so
 * `DeltaChannel`s (which is what an agent's `messages` is) had no saver to
 * replay their ancestor writes and silently came back empty.
 *
 * Fixed in langchain-ai/langgraph#8470, which muffin-agent pins a fork for
 * until it ships. The reconstruction is deliberately NOT kept as a fallback: it
 * would mask a regression if that pin were ever dropped too early, and reading
 * one authoritative source beats silently choosing between two.
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
 * This is what replaced the `tool_runs` capture channel. A tool call is already a
 * first-class part of the message history — an `AIMessage.tool_calls` entry paired
 * with the `ToolMessage` carrying its result — so the panel reads the same thing
 * LangGraph persisted rather than a parallel record the backend had to maintain in
 * graph state.
 *
 * A call with no matching `ToolMessage` is still reported (status `pending`): the run
 * may have been cancelled mid-call, and silently dropping it would hide that.
 *
 * **Field names are the panel's contract, not ours.** `ToolRunsPanel` reads
 * `args_preview` / `output_preview` / `error`. Emitting `args`/`output` instead
 * left successful calls rendering blank while errors rendered fine — `error` was
 * the one name that happened to match. `zToolRun` is a `looseObject`, so the
 * wrong keys passed validation silently.
 *
 * `output_preview` carries the **full** content, not a preview. The name is
 * historical: the old capture channel capped it because it lived in graph state,
 * and the panel notes a capped value "never parsed as a chart". Read from the
 * transcript on demand there is no storage cost, so charts and JSON now render.
 *
 * Everything here comes from the transcript — **nothing needs the tool cache**.
 * `ToolResultCacheMiddleware` never truncates a `ToolMessage`; it returns the
 * full content and attaches `additional_kwargs.cache =
 * {hit, tool_name, args_hash, byte_size}`. So the cache's `args_hash` is read
 * off the message rather than recomputed — which also avoids reproducing
 * Python's `json.dumps(args, sort_keys=True)` from JS, where the separators,
 * `ensure_ascii` escaping and float formatting (`1.0` vs `1`) all differ and a
 * mismatched hash would silently miss.
 *
 * The panel still uses that hash to join the Store entry for a payload's size
 * and age, but no longer *depends* on it to show the output.
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
        // Straight off the message — see the note above on why this is not
        // recomputed from the args.
        args_hash: cache?.args_hash,
        cache_hit: cache?.hit,
        // Stringified so the panel's `tryParse` can render it as a JSON block
        // instead of one long line of text.
        args_preview: call.args === undefined ? '' : JSON.stringify(call.args),
        // Errors carry their content in `error`; keeping it out of the output
        // slot stops the same text rendering twice.
        output_preview: status === 'error' ? '' : (text ?? ''),
        error: status === 'error' ? text : undefined,
      });
    }
  }
  // Validated at the boundary like every other backend-shaped payload.
  return parseArray(zToolRun, runs, 'history.tool_runs');
}

/**
 * Walk the whole tree eagerly, depth-first.
 *
 * Intended for verification and offline analysis — NOT for the UI, where rows are
 * expanded one at a time and each namespace costs a round trip.
 */
export async function fetchTreeEagerly(
  client: Client,
  threadId: string,
  maxDepth = 3,
): Promise<ExecNode[]> {
  const descend = async (ns: string | undefined, depth: number): Promise<ExecNode[]> => {
    const nodes = nodesFromSnapshots(await fetchNamespace(client, threadId, ns));
    if (depth >= maxDepth) return nodes;
    for (const node of nodes) {
      if (!node.namespace) continue;
      node.children = await descend(node.namespace, depth + 1);
    }
    return nodes;
  };
  return descend(undefined, 0);
}
