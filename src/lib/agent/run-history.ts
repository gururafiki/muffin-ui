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

/**
 * The child nodes that ran inside one namespace, in execution order.
 *
 * Tasks repeat across snapshots (a task pending in step N appears again in N+1), so
 * they are de-duplicated by task id, and a later snapshot may carry the result or
 * error an earlier one lacked.
 */
export function nodesFromSnapshots(snapshots: HistorySnapshot[]): ExecNode[] {
  const seen = new Map<string, ExecNode>();
  // getHistory returns newest-first; execution order is the reverse.
  for (const snap of [...snapshots].reverse()) {
    for (const task of snap.tasks ?? []) {
      if (!task?.id || isInternalNode(task.name ?? '')) continue;
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
 * The messages each task WROTE, in execution order.
 *
 * This exists because `values.messages` is empty for every deep agent — measured
 * on production thread 019fa546: `ticker_classification` reports 31 snapshots
 * with `values.messages == []` while its tasks demonstrably ran 10 model turns
 * and 8 tool calls. The same holds for `criteria_definition` and each criterion
 * `evaluate`; only plain (non-deep) agents like `synthesis` populate the channel.
 * Applying pending writes does not help — `POST /state` on that namespace also
 * returns 0 messages.
 *
 * The per-task writes, though, are complete and ordered. They are also the more
 * faithful record: they say which superstep produced which message.
 *
 * A task recurs across snapshots and the earliest occurrence may not carry its
 * result yet, so the first NON-EMPTY write per task wins while first-seen order
 * is preserved.
 */
function messagesFromTaskWrites(snapshots: HistorySnapshot[]): unknown[] {
  const order: string[] = [];
  const byTask = new Map<string, unknown[]>();
  // getHistory is newest-first; execution order is the reverse.
  for (const snap of [...snapshots].reverse()) {
    for (const task of snap.tasks ?? []) {
      if (!task?.id) continue;
      if (!byTask.has(task.id)) {
        order.push(task.id);
        byTask.set(task.id, []);
      }
      const written = (task.result as { messages?: unknown } | undefined)?.messages;
      if (Array.isArray(written) && written.length && byTask.get(task.id)!.length === 0) {
        byTask.set(task.id, written);
      }
    }
  }
  return order.flatMap((id) => byTask.get(id) ?? []);
}

/** The messages a namespace recorded — its transcript, tool calls included. */
export function messagesFromSnapshots(snapshots: HistorySnapshot[]): unknown[] {
  let fromValues: unknown[] = [];
  for (const snap of snapshots) {
    const msgs = (snap.values as { messages?: unknown })?.messages;
    if (Array.isArray(msgs) && msgs.length > fromValues.length) fromValues = msgs;
  }
  // Whichever is richer, never both: the two overlap for plain agents, and
  // concatenating them would double every message.
  const fromWrites = messagesFromTaskWrites(snapshots);
  return fromWrites.length > fromValues.length ? fromWrites : fromValues;
}

/** The richest `values` a namespace recorded, for rendering its structured output. */
export function latestValues(snapshots: HistorySnapshot[]): Record<string, unknown> {
  // getHistory is newest-first, so the first snapshot with values wins.
  for (const snap of snapshots) {
    if (snap.values && Object.keys(snap.values).length > 0) return snap.values;
  }
  return {};
}

type RawMessage = {
  type?: string;
  role?: string;
  name?: string;
  status?: string;
  content?: unknown;
  tool_calls?: { id?: string; name?: string; args?: unknown }[];
  tool_call_id?: string;
};

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
      runs.push({
        tool: call.name,
        agent,
        args: call.args,
        // `status` on a ToolMessage is LangChain's own success/error flag.
        status: !result ? 'pending' : result.status === 'error' ? 'error' : 'ok',
        output: result ? messageText(result.content) : undefined,
        error: result?.status === 'error' ? messageText(result.content) : undefined,
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
