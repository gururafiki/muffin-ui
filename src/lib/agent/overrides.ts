/**
 * Per-run `configurable` overrides — the data half of the runner's "Advanced
 * options" block. Kept separate from the UI so both the generic runner and the
 * bespoke council screen build overrides the same way.
 */
import type { AdvancedField } from './registry';

export type OverrideValue = string | boolean;

/** Seed UI state for an agent's advanced fields (booleans take their `default`). */
export function initialOverrides(fields: AdvancedField[] | undefined): Record<string, OverrideValue> {
  const out: Record<string, OverrideValue> = {};
  for (const f of fields ?? []) {
    if (f.type === 'boolean') out[f.key] = f.default ?? false;
  }
  return out;
}

/**
 * Turn the collected advanced-option state into a `configurable` override map.
 * `number` / `select` are emitted only when set (so a blank leaves the server
 * default); `boolean` is always emitted so a default-`true` knob can be turned
 * off.
 */
export function buildOverrides(
  fields: AdvancedField[] | undefined,
  state: Record<string, OverrideValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields ?? []) {
    const v = state[f.key];
    if (f.type === 'boolean') {
      out[f.key] = typeof v === 'boolean' ? v : f.default ?? false;
    } else if (f.type === 'number') {
      const s = String(v ?? '').trim();
      if (!s) continue;
      const n = Number(s);
      if (Number.isFinite(n)) out[f.key] = n;
    } else {
      const s = String(v ?? '').trim();
      if (s) out[f.key] = s;
    }
  }
  return out;
}
