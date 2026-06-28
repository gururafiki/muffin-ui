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
  resultRenderer?: 'research';
  /** Per-run `configurable` overrides shown in the runner's "Advanced options". */
  advanced?: AdvancedField[];
  custom?: CustomScreen;
  /**
   * Conversational agent: drive it through the multi-turn chat screen
   * (resume a thread, send follow-up messages) instead of the single-shot
   * runner. Requires the graph to operate on a `messages` state key.
   */
  chat?: boolean;
}

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
    resultKey: 'synthesis',
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
    resultKey: 'portfolio_decision',
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
