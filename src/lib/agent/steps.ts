import type { IconName } from '@/components/icons';

export interface StepInfo {
  /** One-line, human-readable description of what this graph step is doing. */
  label: string;
  icon: IconName;
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

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export interface ToolStep extends StepInfo {
  /** Secondary one-liner (e.g. a sub-agent's brief, a file path). */
  sublabel?: string;
  /** A sub-agent delegation (`task`) — render as an emphasised section. */
  isSubagent: boolean;
}

/**
 * Friendly, informative metadata for one tool call, derived from its name and
 * arguments. Turns opaque deep-agent tool names into a readable timeline row.
 */
export function toolStepMeta(name: string, args: Record<string, unknown> = {}): ToolStep {
  const n = (name ?? '').toLowerCase();

  if (n === 'task' || /sub_?agent|delegate/.test(n)) {
    const type = firstString(args, ['subagent_type', 'subagent', 'name']);
    return {
      label: type ? titleCase(type) : 'Sub-agent',
      icon: 'agents',
      sublabel: firstString(args, ['description', 'prompt', 'query', 'instructions']),
      isSubagent: true,
    };
  }
  if (/write_todos|todo/.test(n)) {
    const todos = Array.isArray(args.todos) ? (args.todos as unknown[]).length : undefined;
    return { label: 'Updated the to-do list', icon: 'criteria', sublabel: todos ? `${todos} items` : undefined, isSubagent: false };
  }
  if (/discover.*cache|cache.*discover/.test(n)) return { label: 'Discovered cached data', icon: 'research', isSubagent: false };
  if (/write_cached|cache/.test(n)) return { label: 'Saved tool output', icon: 'files', sublabel: firstString(args, ['tool_name', 'name', 'path', 'file_path']), isSubagent: false };
  if (/get_tool_output_schema|schema/.test(n)) return { label: 'Inspected a tool schema', icon: 'tools', sublabel: firstString(args, ['tool_name', 'name']), isSubagent: false };
  if (/read_file|read/.test(n)) return { label: 'Read a file', icon: 'files', sublabel: firstString(args, ['file_path', 'path', 'file']), isSubagent: false };
  if (/write_file|edit_file|write|edit/.test(n)) return { label: 'Wrote a file', icon: 'files', sublabel: firstString(args, ['file_path', 'path', 'file']), isSubagent: false };
  if (n === 'ls' || /list|glob/.test(n)) return { label: 'Listed files', icon: 'files', sublabel: firstString(args, ['path', 'dir']), isSubagent: false };
  if (/search|web|fetch|retriev/.test(n)) return { label: 'Searched', icon: 'research', sublabel: firstString(args, ['query', 'q', 'url']), isSubagent: false };

  return { label: titleCase(name || 'tool'), icon: 'tools', sublabel: firstString(args, ['query', 'description', 'path', 'file_path']), isSubagent: false };
}
