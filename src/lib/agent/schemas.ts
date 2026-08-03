/**
 * Runtime validation for the LangGraph payloads this app does not own.
 *
 * These schemas mirror `muffin-agent` state shapes — `ToolTelemetryMiddleware`
 * records, the criteria workers' evaluations, the council persona signals —
 * **keep them in sync with the backend**, exactly like `settings/configurable.ts`
 * mirrors `BaseConfiguration`.
 *
 * Philosophy: everything is `looseObject` with optional fields (unknown fields
 * pass through, so renderers like `StructuredOutput` still see the full
 * payload), and array parsing skips malformed members instead of failing the
 * whole slice — a backend drift can degrade one row, never blank a panel.
 * Mismatches are surfaced once per label in dev.
 */
import { z } from 'zod';

const zStr = z.string().optional();
const zNum = z.number().optional();

/** One tool-execution record (backend `ToolTelemetryMiddleware`). */
export const zToolRun = z.looseObject({
  tool: zStr,
  agent: zStr,
  is_subagent_call: z.boolean().optional(),
  /** 'ok' | 'error' | 'duplicate_blocked' | 'truncated' | future values. */
  status: zStr,
  cache_hit: z.boolean().optional(),
  args_preview: zStr,
  output_preview: zStr,
  error: z.string().nullish(),
  /** Store key of the cached payload (`get_args_hash(args)`) — joins a row to
   * its full `["cache", tool]` entry for on-expand payload/size/timestamp. */
  args_hash: z.string().nullish(),
});
export type ToolRun = z.infer<typeof zToolRun>;

const zSubCriterion = z.looseObject({
  name: zStr,
  criterion_name: zStr,
  signal: zStr,
  score: zNum,
  reasoning: zStr,
});

/** One criteria-analysis worker's evaluation (per-criterion scorecard row). */
export const zCriterionEvaluation = z.looseObject({
  criterion_name: zStr,
  signal: zStr,
  score: zNum,
  confidence: zNum,
  weight: zNum,
  reasoning: zStr,
  counterargument: zStr,
  evidence_summary: z.array(z.unknown()).optional(),
  data_sources: z.array(z.unknown()).optional(),
  limitations: z.array(z.unknown()).optional(),
  sub_criteria: z.array(zSubCriterion).optional(),
  tool_runs: z.array(zToolRun).optional(),
  /** Backend truthing flag: false = the worker made zero tool calls. */
  data_collected: z.boolean().optional(),
});
export type CriterionEvaluation = z.infer<typeof zCriterionEvaluation>;

/** One council member's verdict (`values.persona_signals[]`). */
export const zPersonaSignal = z.looseObject({
  agent_id: zStr,
  signal: zStr,
  confidence: zNum,
  reasoning: zStr,
  evidence: z.record(z.string(), z.unknown()).optional(),
});
export type PersonaSignal = z.infer<typeof zPersonaSignal>;

/**
 * The criteria graph's `get_stream_writer()` event — the ONLY live
 * per-criterion signal (parallel Send workers commit in one superstep, so
 * root `values` only shows the scorecard at the barrier).
 */
export const zCriterionEvent = z.object({
  type: z.literal('criterion_evaluated'),
  evaluation: zCriterionEvaluation,
});

const warned = new Set<string>();
function warnDrift(label: string, error: z.ZodError): void {
  if (!__DEV__ || warned.has(label)) return;
  warned.add(label);
  console.warn(`[schemas] backend payload drift in ${label}:`, z.prettifyError(error));
}

/**
 * Parse an unknown as an array of `schema` members, skipping (and dev-warning
 * about) malformed members. `[]` for anything that isn't an array.
 */
export function parseArray<T>(schema: z.ZodType<T>, value: unknown, label: string): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else warnDrift(label, r.error);
  }
  return out;
}

/** Parse an unknown as one `schema` value; `undefined` (+ dev warn) on mismatch. */
export function parseOr<T>(schema: z.ZodType<T>, value: unknown, label: string): T | undefined {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  warnDrift(label, r.error);
  return undefined;
}

/**
 * Parse a JSON string, guarding against very large payloads.
 *
 * Not a zod helper, but this is the module that owns "turn an untrusted payload
 * into something typed", and its only caller (`renderers/tool-registry.tsx`)
 * reaches for it right before handing the result to a schema.
 */
export function safeParse(t: string): unknown {
  try {
    return JSON.parse(t.length > 20000 ? '' : t);
  } catch {
    return undefined;
  }
}
