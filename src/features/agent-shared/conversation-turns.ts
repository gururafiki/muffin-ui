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
  | { kind: 'tool'; id: string; call: ToolCall; result?: AnyMessage; error?: boolean }
  | { kind: 'nudge'; id: string; text: string };
export type Turn = { human?: AnyMessage; steps: Step[]; answer?: AnyMessage };

/**
 * The backend's `_StructuredOutputRetryMiddleware` injects a `HumanMessage`
 * reminder ("Call the `X` tool now...") tagged with this `additional_kwargs`
 * marker — keep in sync with `_NUDGE_MARKER` in
 * `_structured_output_retry_middleware.py`.
 */
const RETRY_NUDGE_KEY = 'structured_output_retry_nudge';

/** True for an injected retry-reminder message, not a genuine user turn. */
export function isRetryNudge(m: AnyMessage): boolean {
  return m.additional_kwargs?.[RETRY_NUDGE_KEY] === true;
}

/** One sub-agent row in the Overview panels: a protocol-v2 discovered subgraph
 * invocation, or a caller-rendered result row. */
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
      if (isRetryNudge(m)) {
        // An injected reminder, not a new user turn — keep it inline with the
        // turn's AI activity so it lands in its actual chronological spot.
        if (!cur) {
          cur = { steps: [] };
          turns.push(cur);
        }
        aiSeq.push({ turn: cur, m });
        continue;
      }
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
      if (isRetryNudge(m)) {
        t.steps.push({ kind: 'nudge', id: m.id ?? `nudge-${i}`, text: messageText(m.content).trim() });
        return;
      }
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

/** In summary view, keep only high-signal steps (sub-agents, final structured
 * output + to-do updates); hide the orchestrator's plumbing (caching, file
 * reads, schema, thinking). */
export function isSignificant(step: Step): boolean {
  if (step.kind === 'think' || step.kind === 'nudge') return false;
  // `toolStepMeta` needs the tool's original casing — the structured-output
  // discriminator is case-sensitive (PascalCase vs. snake_case).
  const name = step.call.name ?? '';
  const meta = toolStepMeta(name, step.call.args ?? {});
  return meta.isSubagent || !!meta.isFinalOutput || /write_todos|todo/.test(name.toLowerCase());
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
