import { has } from './helpers';
import type { AgentDef } from './types';

export const research: AgentDef = {
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
};
