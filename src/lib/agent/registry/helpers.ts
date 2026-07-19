/** Shared predicates + field presets for the per-agent registry files. */
import type { AgentInputField, StageDef } from './types';

export const isEmpty = (v: unknown): boolean => {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v as object).every(isEmpty);
  return false;
};

export const has = (values: Record<string, unknown>, key: string): boolean => !isEmpty(values[key]);

/**
 * Resolve a stage's `output` (values key or selector) against the run state,
 * returning `undefined` for empty results (null / `[]` / `{}` / an object whose
 * every value is empty) so callers can treat "no output" uniformly. The single
 * place that narrows the `string | selector` union.
 */
export function stageOutput(
  stage: StageDef,
  values: Record<string, unknown> | undefined,
): unknown {
  if (stage.output == null || values == null) return undefined;
  const raw = typeof stage.output === 'function' ? stage.output(values) : values[stage.output];
  return isEmpty(raw) ? undefined : raw;
}

export const tickerField: AgentInputField = {
  key: 'ticker',
  label: 'Ticker',
  placeholder: 'AAPL',
  required: true,
  autoCapitalize: 'characters',
};
