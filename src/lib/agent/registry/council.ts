import { has, tickerField } from './helpers';
import type { AgentDef } from './types';

export const council: AgentDef = {
  id: 'council',
  title: 'Investor Council',
  icon: 'council',
  tagline: '13 famous-investor personas debate, then a judge synthesises.',
  inputs: [tickerField, { key: 'query', label: 'Focus (optional)', placeholder: 'Is the moat durable?' }],
  buildInput: (v) => ({ ticker: v.ticker?.toUpperCase(), ...(v.query ? { query: v.query } : {}) }),
  exampleConfigs: [
    { label: 'AAPL', values: { ticker: 'AAPL', query: 'Is the moat durable?' } },
    { label: 'MSFT', values: { ticker: 'MSFT' } },
    { label: 'AMZN', values: { ticker: 'AMZN', query: 'Where do the legends disagree most?' } },
  ],
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
    { key: 'judge', label: 'The judge synthesises', icon: 'sparkle', done: (v) => has(v, 'council_synthesis'), active: /judge|synth/i, output: 'council_synthesis' },
  ],
};
