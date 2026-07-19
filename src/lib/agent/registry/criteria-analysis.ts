import { has, tickerField } from './helpers';
import type { AgentDef } from './types';

export const criteriaAnalysis: AgentDef = {
  id: 'criteria_analysis',
  title: 'Criteria Analysis',
  icon: 'criteria',
  tagline: 'Sector-aware, criteria-driven scoring and synthesis.',
  inputs: [tickerField, { key: 'query', label: 'Focus (optional)', placeholder: 'Buy at current price?' }],
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
};
