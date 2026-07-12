/**
 * Agent registry — "one graph → one screen".
 *
 * Each entry maps a LangGraph `assistant_id` (from muffin-agent/langgraph.json)
 * to the inputs its UI collects, how to shape the run `input`, and which state
 * key carries the headline result. Adding a new agent = add one entry here; the
 * generic runner handles the rest. A `custom` key opts an agent into a bespoke
 * screen (e.g. the council avatars) instead of the generic transcript view.
 */
import type { IconName } from '@/components/icons';

export type CustomScreen = 'council';

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
   * Values key holding this stage's structured output. Completed runs have no
   * replayable event stream, so this is the history fallback shown when the
   * stage's discovered sub-agent row is expanded (live runs show the scoped
   * transcript instead).
   */
  output?: string;
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

const has = (values: Record<string, unknown>, key: string): boolean => {
  const v = values[key];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
};

const ticker: AgentInputField = {
  key: 'ticker',
  label: 'Ticker',
  placeholder: 'AAPL',
  required: true,
  autoCapitalize: 'characters',
};

export const AGENTS: AgentDef[] = [
  {
    id: 'research',
    title: 'Deep Research',
    icon: 'research',
    tagline: 'Web research with cited, reranked evidence.',
    inputs: [
      { key: 'query', label: 'Question', placeholder: 'What is driving NVDA revenue growth?', required: true },
    ],
    buildInput: (v) => ({ query: v.query }),
    resultKey: 'output',
    resultRenderer: 'research',
    advanced: [
      { key: 'research_default_mode', label: 'Research mode', type: 'select', options: ['speed', 'balanced', 'quality'] },
      { key: 'max_search_results', label: 'Max search results', type: 'number', placeholder: '8' },
    ],
    stages: [
      { key: 'classify', label: 'Understand the question', icon: 'thinking', done: (v) => has(v, 'classification'), active: /classif/i, output: 'classification' },
      { key: 'search', label: 'Gather evidence', icon: 'research', done: (v) => has(v, 'evidence'), active: /search|retriev|collect|firecrawl/i, output: 'evidence' },
      { key: 'rerank', label: 'Rank the best sources', icon: 'criteria', done: (v) => has(v, 'reranked_evidence'), active: /rerank/i, output: 'reranked_evidence' },
      { key: 'write', label: 'Write the answer', icon: 'sparkle', done: (v) => has(v, 'output'), active: /writ|answer|synth/i, output: 'output' },
    ],
  },
  {
    id: 'council',
    title: 'Investor Council',
    icon: 'council',
    tagline: '13 famous-investor personas debate, then a judge synthesises.',
    inputs: [ticker, { key: 'query', label: 'Focus (optional)', placeholder: 'Is the moat durable?' }],
    buildInput: (v) => ({ ticker: v.ticker?.toUpperCase(), ...(v.query ? { query: v.query } : {}) }),
    resultKey: 'council_synthesis',
    advanced: [
      {
        key: 'include_specialists',
        label: 'Include specialist signals',
        type: 'boolean',
        default: false,
        hint: 'Adds 6 deterministic specialist analysts (technicals, sentiment, fundamentals, growth, valuation, news) to the council.',
      },
    ],
    custom: 'council',
    stages: [
      {
        key: 'deliberate',
        label: 'The council deliberates',
        icon: 'council',
        done: (v) => (Array.isArray(v.council_synthesis) ? false : has(v, 'council_synthesis')),
        active: /persona|buffett|graham|wood|munger|ackman|burry|pabrai|taleb|lynch|fisher|jhunjhunwala|druckenmiller|damodaran|specialist|analysis/i,
        expected: 13,
        children: (v) =>
          ((v.persona_signals as { agent_id?: string }[] | undefined) ?? []).map((s, i) => ({
            key: s.agent_id ?? String(i),
            label: (s.agent_id ?? 'vote').replace(/_/g, ' '),
            done: true,
          })),
      },
      { key: 'judge', label: 'The judge synthesises', icon: 'sparkle', done: (v) => has(v, 'council_synthesis'), active: /judge|synth/i },
    ],
  },
  {
    id: 'criteria_analysis',
    title: 'Criteria Analysis',
    icon: 'criteria',
    tagline: 'Sector-aware, criteria-driven scoring and synthesis.',
    inputs: [ticker, { key: 'query', label: 'Focus (optional)', placeholder: 'Buy at current price?' }],
    // `sector`/`market` may arrive via initialValues from a sector/country
    // context to pre-classify the run (CriteriaAnalysisState accepts them).
    buildInput: (v) => ({
      ticker: v.ticker?.toUpperCase(),
      ...(v.query ? { query: v.query } : {}),
      ...(v.sector ? { sector: v.sector } : {}),
      ...(v.market ? { market: v.market } : {}),
    }),
    resultRenderer: 'criteria',
    advanced: [
      // NB: tool-execution capture is unconditional backend-side (the graph
      // opts in by declaring the `tool_runs` state channel) — no toggle here.
      {
        key: 'tool_lessons_mode',
        label: 'Tool lessons',
        type: 'select',
        options: ['read_and_record', 'read_only', 'off'],
        hint: 'How agents use lessons learned from prior tool failures.',
      },
    ],
    // Stage order mirrors the real graph: classify → (define ∥ methodology) →
    // merge → evaluate (Send fan-out) → synthesis. `merged_criteria` is written
    // BEFORE the fan-out, so it marks the merge stage — never the evaluate one
    // (the old predicate skipped straight to "Synthesise the verdict" while
    // workers were still running).
    stages: [
      { key: 'classify', label: 'Classify the stock', icon: 'thinking', node: 'ticker_classification', done: (v) => has(v, 'classification'), active: /classif/i, output: 'classification' },
      { key: 'define', label: 'Define the criteria', icon: 'criteria', node: 'criteria_definition', done: (v) => has(v, 'criteria_definition'), active: /criteria_definition|define/i, output: 'criteria_definition' },
      { key: 'methodology', label: 'Pick a valuation methodology', icon: 'evaluation', node: 'valuation_methodology', done: (v) => has(v, 'valuation_methodology'), active: /valuation|methodolog/i, output: 'valuation_methodology' },
      { key: 'merge', label: 'Merge the scorecard', icon: 'files', done: (v) => has(v, 'merged_criteria'), active: /merge/i },
      {
        key: 'evaluate',
        label: 'Evaluate each criterion',
        icon: 'agents',
        node: 'criterion_evaluation',
        done: (v) => {
          if (has(v, 'synthesis')) return true;
          const merged = v.merged_criteria as unknown[] | undefined;
          const evals = v.criterion_evaluations as unknown[] | undefined;
          return !!merged?.length && (evals?.length ?? 0) >= merged.length;
        },
        active: /criterion|evaluat/i,
        expected: (v) => (v.merged_criteria as unknown[] | undefined)?.length,
        children: (v) => {
          const evals = (v.criterion_evaluations as { criterion_name?: string }[] | undefined) ?? [];
          return evals.map((c, i) => ({ key: c.criterion_name ?? String(i), label: c.criterion_name ?? `Criterion ${i + 1}`, done: true }));
        },
      },
      { key: 'synthesis', label: 'Synthesise the verdict', icon: 'sparkle', node: 'synthesis', done: (v) => has(v, 'synthesis'), active: /synth/i, output: 'synthesis' },
    ],
  },
  {
    id: 'stock_evaluation',
    title: 'Stock Evaluation',
    icon: 'evaluation',
    tagline: 'Full deep-agent evaluation: plan, collect, validate, analyse.',
    inputs: [
      { key: 'prompt', label: 'Prompt', placeholder: 'Evaluate AAPL as a long-term holding', required: true },
    ],
    buildInput: (v) => ({ messages: [{ type: 'human', content: v.prompt }] }),
    resultKey: 'messages',
    chat: true,
    examples: [
      'Evaluate AAPL as a long-term holding. Cover the thesis, valuation and key risks.',
      'Is NVDA overvalued at today’s price?',
      'Compare MSFT and GOOGL on fundamentals and momentum.',
    ],
  },
  {
    id: 'trading_decision',
    title: 'Trading Decision',
    icon: 'trading',
    tagline: 'Analyst reports → bull/bear debate → risk debate → a portfolio call.',
    inputs: [
      ticker,
      { key: 'query', label: 'Focus (optional)', placeholder: 'Entry on a pullback?' },
      { key: 'narrative', label: 'Narrative (optional)', placeholder: 'Your current thesis / position' },
    ],
    buildInput: (v) => ({
      ticker: v.ticker?.toUpperCase(),
      ...(v.query ? { query: v.query } : {}),
      ...(v.narrative ? { narrative: v.narrative } : {}),
    }),
    // No `resultKey`: the trading widget renders the whole state (reports,
    // debate, judge, portfolio decision), not just one field.
    resultRenderer: 'trading',
    stages: [
      { key: 'market', label: 'Market & technicals', icon: 'markets', done: (v) => has(v, 'market_report'), active: /market_analyst/i, output: 'market_report' },
      { key: 'fundamentals', label: 'Fundamentals', icon: 'criteria', done: (v) => has(v, 'fundamentals_report'), active: /fundamentals_analyst/i, output: 'fundamentals_report' },
      { key: 'news', label: 'News', icon: 'research', done: (v) => has(v, 'news_report'), active: /news_analyst/i, output: 'news_report' },
      { key: 'sentiment', label: 'Social sentiment', icon: 'sparkle', done: (v) => has(v, 'sentiment_report'), active: /social_analyst|sentiment/i, output: 'sentiment_report' },
      {
        key: 'debate',
        label: 'Bull vs bear debate',
        icon: 'council',
        done: (v) => has(v, 'investment_judge'),
        active: /bull|bear|invest.*debat|research_manager/i,
        children: (v) => {
          const rounds = (v.investment_bull_responses as unknown[] | undefined)?.length ?? 0;
          return Array.from({ length: rounds }, (_, i) => ({ key: `r${i}`, label: `Round ${i + 1}`, done: true }));
        },
      },
      { key: 'judge', label: 'The judge rules', icon: 'council', done: (v) => has(v, 'investment_judge'), active: /judge/i, output: 'investment_judge' },
      { key: 'trader', label: 'Trader drafts the plan', icon: 'trading', done: (v) => has(v, 'trader'), active: /trader/i, output: 'trader' },
      { key: 'risk', label: 'Risk debate', icon: 'warning', done: (v) => has(v, 'portfolio_decision'), active: /risk|debator/i },
      { key: 'portfolio', label: 'Portfolio call', icon: 'portfolio', done: (v) => has(v, 'portfolio_decision'), active: /portfolio/i, output: 'portfolio_decision' },
    ],
    advanced: [
      { key: 'max_investment_debate_rounds', label: 'Bull/bear debate rounds', type: 'number', placeholder: '2' },
      { key: 'max_risk_debate_rounds', label: 'Risk debate rounds', type: 'number', placeholder: '1' },
      {
        key: 'reflection_enabled',
        label: 'Reflection memory',
        type: 'boolean',
        default: true,
        hint: 'Learn from past decisions on this ticker (needs a persistent store + user id).',
      },
    ],
  },
];

export const getAgent = (id: string): AgentDef | undefined => AGENTS.find((a) => a.id === id);
