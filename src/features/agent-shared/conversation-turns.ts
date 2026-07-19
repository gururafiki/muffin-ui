/**
 * Pure transcript logic — no JSX. Folds a LangGraph message list into
 * renderable turns and groups steps into the orchestrator timeline tree.
 * The UI halves live in `conversation.tsx` / `message-bubbles.tsx`.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { toMessageDict } from '@langchain/langgraph-sdk/ui';

import { messageKind, messageText, type AnyMessage } from '@/lib/agent/renderers';
import { toolStepMeta } from '@/lib/agent/steps';

export type ViewMode = 'summary' | 'verbose';

export type MessageActions = {
  busy: boolean;
  onCopy: (text: string) => void;
  // Branching / edit-fork / regenerate are legacy-hook-only capabilities; the
  // protocol-v2 stack (ChatScreen after M12b) omits them, so they're optional
  // and their buttons are hidden when the handler is absent.
  onEdit?: (message: AnyMessage, text: string) => void;
  onRegenerate?: (message: AnyMessage) => void;
  branchInfo?: (message: AnyMessage) => { index: number; total: number; prev?: string; next?: string } | undefined;
  onSetBranch?: (branch: string) => void;
};

export type ToolCall = { name?: string; args?: Record<string, unknown>; id?: string };
export type Step =
  | { kind: 'think'; id: string; text: string }
  | { kind: 'tool'; id: string; call: ToolCall; result?: AnyMessage; error?: boolean };
export type Turn = { human?: AnyMessage; steps: Step[]; answer?: AnyMessage };

/** One sub-agent run row: a captured transcript (backend `subagent_runs`
 * state channel) and/or a protocol-v2 discovered subgraph invocation. */
export type SubagentRun = {
  name?: string;
  description?: string;
  messages?: AnyMessage[];
  /** Full subgraph state (native sub-agents) — powers stage-oriented detail. */
  stateValues?: Record<string, unknown>;
  /** Live discovery status (protocol-v2 subgraph snapshots). */
  status?: 'running' | 'complete' | 'error';
  /** Caller-provided expanded content (scoped live transcript / evaluation). */
  renderDetail?: () => React.ReactNode;
};
export type SubagentRuns = Record<string, SubagentRun>;

/** A transcript accepts persisted dicts AND live `stream.messages` instances. */
export type ConversationMessage = AnyMessage | BaseMessage;

/** Normalise message-class instances to the loose dict shape the fold reads. */
export function coerceMessages(messages: readonly ConversationMessage[]): AnyMessage[] {
  return messages.map((m) =>
    typeof (m as BaseMessage).getType === 'function'
      ? (toMessageDict(m as BaseMessage) as AnyMessage)
      : (m as AnyMessage),
  );
}

/** Find the captured transcript for a `task` call, matched by its description. */
export function findRun(runs: SubagentRuns | undefined, description?: string): SubagentRun | undefined {
  if (!runs || !description) return undefined;
  const target = description.trim();
  for (const r of Object.values(runs)) {
    const d = r.description?.trim();
    if (d && (d === target || target.startsWith(d) || d.startsWith(target))) return r;
  }
  return undefined;
}

/** Split a message list into turns, pairing tool calls with their results. */
export function buildTurns(messages: AnyMessage[]): Turn[] {
  const toolById = new Map<string, AnyMessage>();
  for (const m of messages) {
    if (messageKind(m) === 'tool') {
      const id = (m as { tool_call_id?: string }).tool_call_id;
      if (id) toolById.set(id, m);
    }
  }

  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const aiSeq: { turn: Turn; m: AnyMessage }[] = [];

  for (const m of messages) {
    const kind = messageKind(m);
    if (kind === 'human' || kind === 'user') {
      cur = { steps: [] };
      cur.human = m;
      turns.push(cur);
      continue;
    }
    if (kind === 'tool') continue;
    if (!cur) {
      cur = { steps: [] };
      turns.push(cur);
    }
    aiSeq.push({ turn: cur, m });
  }

  // Within each turn, the final content-only AI message is the answer; the rest
  // become "thinking" + tool steps.
  for (const t of turns) {
    const ais = aiSeq.filter((x) => x.turn === t).map((x) => x.m);
    ais.forEach((m, i) => {
      const text = messageText(m.content).trim();
      const calls = (m.tool_calls ?? []) as ToolCall[];
      const isLast = i === ais.length - 1;
      if (isLast && text && calls.length === 0) {
        t.answer = m;
        return;
      }
      if (text) t.steps.push({ kind: 'think', id: `${m.id ?? 't'}-think`, text });
      for (const c of calls) {
        const result = c.id ? toolById.get(c.id) : undefined;
        t.steps.push({
          kind: 'tool',
          id: c.id ?? `${m.id}-${c.name}`,
          call: c,
          result,
          error: (result as { status?: string } | undefined)?.status === 'error',
        });
      }
    });
  }
  return turns;
}

export type ToolStepT = Extract<Step, { kind: 'tool' }>;
export type TimelineNode =
  | { kind: 'leaf'; step: Step }
  | { kind: 'sub'; name: string; calls: ToolStepT[] };

/** Group a flat step list into an orchestrator tree: parent steps stay as
 * leaves, while sub-agent (`task`) calls collapse under one node per agent. */
export function groupTimeline(steps: Step[]): { nodes: TimelineNode[]; subCount: number } {
  const nodes: TimelineNode[] = [];
  const subByName = new Map<string, Extract<TimelineNode, { kind: 'sub' }>>();
  for (const step of steps) {
    if (step.kind === 'tool') {
      const meta = toolStepMeta(step.call.name ?? 'tool', step.call.args ?? {});
      if (meta.isSubagent) {
        let node = subByName.get(meta.label);
        if (!node) {
          node = { kind: 'sub', name: meta.label, calls: [] };
          subByName.set(meta.label, node);
          nodes.push(node);
        }
        node.calls.push(step);
        continue;
      }
    }
    nodes.push({ kind: 'leaf', step });
  }
  return { nodes, subCount: subByName.size };
}

/** In summary view, keep only high-signal steps (sub-agents + to-do updates);
 * hide the orchestrator's plumbing (caching, file reads, schema, thinking). */
export function isSignificant(step: Step): boolean {
  if (step.kind === 'think') return false;
  const name = (step.call.name ?? '').toLowerCase();
  return toolStepMeta(name, step.call.args ?? {}).isSubagent || /write_todos|todo/.test(name);
}

/** Parse a whole body as JSON when it looks like one (mirrors ToolResult). */
export function tryParseJson(t: string): unknown {
  if (!(t.startsWith('{') || t.startsWith('[')) || t.length >= 8000) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** The sub-agent's headline — its last substantive line — for a collapsed preview. */
export function runPreview(run: SubagentRun): string | undefined {
  const msgs = run.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = messageText(msgs[i].content).trim();
    if (t) return t.replace(/[#*`>|]/g, '').replace(/\s+/g, ' ');
  }
  return run.description;
}
