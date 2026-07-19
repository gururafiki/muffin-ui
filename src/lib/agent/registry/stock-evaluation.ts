import type { AgentDef } from './types';

export const stockEvaluation: AgentDef = {
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
};
