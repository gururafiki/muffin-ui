/** The registry's type surface — see `index.ts` for the "one graph → one screen" story. */
import type { IconName } from '@/components/icons';

export type CustomScreen = 'council';

/**
 * A bespoke renderer for a stage's expanded sub-agent detail, resolved
 * UI-side in `subgraph-detail.tsx` (mirrors `AgentDef.resultRenderer`, so the
 * registry stays free of JSX/component imports). `'debate'` renders the
 * stage's `output` (a conference message list, or the legacy bull/bear lists)
 * as a `DebateView` conversation.
 */
export type StageDetail = 'debate';

export interface AgentInputField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  autoCapitalize?: 'characters' | 'none';
}

/**
 * A per-run override surfaced in the runner's "Advanced options" block. `key` is
 * the `config.configurable` key sent to the backend (read by the graph's
 * `BaseConfiguration` subclass). `number`/`select` are only sent when set;
 * `boolean` is always sent its current value (initialised to `default`) so a
 * user can flip a server default that is `true` (e.g. `reflection_enabled`).
 */
export interface AdvancedField {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  /** Options for `type: 'select'`. */
  options?: string[];
  /** Placeholder for `type: 'number'` (typically the backend default). */
  placeholder?: string;
  hint?: string;
  /** Initial + always-sent value for `type: 'boolean'`. */
  default?: boolean;
}

/** One row in a stage's expanded progress (e.g. a criterion, a persona vote). */
export interface StageChild {
  key: string;
  label: string;
  done: boolean;
}

/**
 * One stage of a graph agent's execution recipe, powering the RunProgress
 * "done / doing / next" checklist. `done` reads the streamed state; `active`
 * matches streamed node names (from `updates` events) so the checklist can
 * point at what is running *right now*.
 */
export interface StageDef {
  key: string;
  label: string;
  icon?: IconName;
  done: (values: Record<string, unknown>) => boolean;
  /**
   * Matches node names that belong to this stage. Used (a) by the legacy
   * hook's liveNode probe (chat screen) and (b) as the discovery fallback
   * when `node` is unset — protocol-v2 subgraph snapshots whose node name
   * matches count towards this stage's status.
   */
  active?: RegExp;
  /**
   * Graph node whose subgraph-discovery snapshots drive this stage's
   * status/progress on the protocol-v2 stack (exact `addNode` name).
   * Plain-function nodes (e.g. merge_criteria) are never discovered —
   * leave unset and rely on `done(values)`.
   */
  node?: string;
  /**
   * This stage's structured output — a values key, or a selector for stages
   * whose output spans several keys / needs a legacy fallback (e.g. the
   * bull/bear debate). Completed runs (and conference subgraphs, which write a
   * non-default messages channel) have no scoped transcript, so this is the
   * history fallback shown when the stage's discovered sub-agent row is
   * expanded. Resolve via `stageOutput(stage, values)`, never `stage.output`
   * directly.
   */
  output?: string | ((values: Record<string, unknown>) => unknown);
  /**
   * Bespoke renderer id for this stage's expanded detail (resolved in
   * `subgraph-detail.tsx`). When unset the detail falls back to the generic
   * `StructuredOutput` of `output`.
   */
  detail?: StageDetail;
  /** Dynamic sub-rows derived from state (criteria, persona votes, …). */
  children?: (values: Record<string, unknown>) => StageChild[];
  /**
   * Expected number of children. A function reads streamed state (e.g.
   * `merged_criteria.length`). Shown as a bare total until children start
   * arriving, then as a `k/N` fraction.
   */
  expected?: number | ((values: Record<string, unknown>) => number | undefined);
}

export interface AgentDef {
  /** assistant_id / graph name registered in langgraph.json */
  id: string;
  title: string;
  icon: IconName;
  tagline: string;
  inputs: AgentInputField[];
  /** Shape the collected field values into the graph's run `input`. */
  buildInput: (values: Record<string, string>) => Record<string, unknown>;
  /** State key holding the final structured output, for headline rendering. */
  resultKey?: string;
  /** Optional tailored renderer for the result (else generic StructuredOutput). */
  resultRenderer?: 'research' | 'criteria' | 'trading';
  /** Per-run `configurable` overrides shown in the runner's "Advanced options". */
  advanced?: AdvancedField[];
  custom?: CustomScreen;
  /**
   * Conversational agent: drive it through the multi-turn chat screen
   * (resume a thread, send follow-up messages) instead of the single-shot
   * runner. Requires the graph to operate on a `messages` state key.
   */
  chat?: boolean;
  /** Example prompts offered on the chat hero screen. */
  examples?: string[];
  /** Execution recipe for graph agents (deep agents use `todos` instead). */
  stages?: StageDef[];
}
