import type { IconName } from '@/components/icons';

export interface StepInfo {
  /** One-line, human-readable description of what this graph step is doing. */
  label: string;
  icon: IconName;
}

/** A captured graph-node execution, used to build the run timeline. */
export interface RunStep extends StepInfo {
  id: string;
  node: string;
  /** Subgraph path (e.g. a sub-agent namespace); empty at the top level. */
  namespace: string[];
  ts: number;
}

/**
 * Map a deep-agent graph node / tool / middleware name to a friendly one-liner.
 *
 * Deep agents (e.g. Stock Evaluation) execute nodes named after their tools and
 * LangChain middleware — e.g. `TodoListMiddleware.AfterModel`, `write_todos`,
 * `task`, `model`. These names are opaque to users, so we translate the common
 * ones into plain language. Unknown names fall back to a humanised version, so
 * the timeline never breaks when the backend adds a node.
 *
 * The matchers are ordered (first hit wins) and matched case-insensitively as a
 * substring, which tolerates the `Middleware.Hook` and tool-name variants.
 */
const MATCHERS: { re: RegExp; label: string; icon: IconName }[] = [
  { re: /write_todos|todo/, label: 'Updating the to-do list', icon: 'criteria' },
  { re: /task|sub_?agent|delegate/, label: 'Delegating to a sub-agent', icon: 'agents' },
  { re: /summari[sz]/, label: 'Summarising to save context', icon: 'sparkle' },
  { re: /plan/, label: 'Planning the approach', icon: 'criteria' },
  { re: /write_file|edit_file|read_file|^ls$|filesystem|file/, label: 'Working with files', icon: 'files' },
  { re: /search|research|retriev|fetch|web/, label: 'Researching', icon: 'research' },
  { re: /prompt_?cach/, label: 'Optimising the prompt cache', icon: 'sparkle' },
  { re: /human_?in_?the_?loop|interrupt|approval/, label: 'Waiting for your approval', icon: 'warning' },
  { re: /tool/, label: 'Running tools', icon: 'tools' },
  { re: /model|agent|llm|generate|respond/, label: 'Thinking', icon: 'thinking' },
];

function humanize(node: string): string {
  // Strip a `.Hook` suffix and middleware suffix, then space out the name.
  const base = node.replace(/middleware/gi, '').replace(/[._]/g, ' ').trim();
  return base.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Working';
}

export function describeStep(node: string): StepInfo {
  const key = node.toLowerCase();
  for (const m of MATCHERS) {
    if (m.re.test(key)) return { label: m.label, icon: m.icon };
  }
  return { label: humanize(node), icon: 'sparkle' };
}
