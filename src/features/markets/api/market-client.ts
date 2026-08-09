/**
 * Reads for the `market` schema — the server-side replacement for the authored
 * numbers in `features/markets/taxonomy.ts`.
 *
 * There is no bespoke API server behind this: `market.performance` is a Postgres
 * table exposed through PostgREST (the `supabase-rest` container), so a read is the
 * same supabase-js call the app already makes for `user_backups`. Rows are
 * anon-readable on purpose — the globe has to render before sign-in.
 *
 * Writes are NEVER done from here. When a row is stale the client asks the
 * `market-refresh` edge function to do it (see `triggerRefresh`); the function holds
 * the service-role key and an atomic claim so concurrent triggers collapse into one
 * upstream fetch.
 */
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import type { Period } from './periods';

/**
 * Mirrors `market.performance` (muffin-deployment/stack/supabase/migrations/02-market.sql)
 * — keep in sync with that migration, the same rule `lib/agent/schemas.ts` follows
 * for backend-owned payloads.
 *
 * `change_pct` is `numeric`. PostgREST v14.12 serialises that as a JSON **number**
 * (measured, including at high precision) — `coerce` is a cheap guard, not a fix for
 * a current bug: some drivers and versions quote numerics to preserve precision, and
 * if that ever happened here `parseArray` would drop EVERY row and the panel would
 * silently fall back to sample data. `scripts/smoke-market.mjs` feeds quoted values
 * so the guard stays honest.
 */
export const zPerformanceRow = z.looseObject({
  scope: z.string(),
  scope_id: z.string(),
  period: z.string(),
  change_pct: z.coerce.number().nullable(),
  as_of: z.string(),
  stale_after: z.string(),
  source: z.string().nullish(),
});

export type PerformanceRow = z.infer<typeof zPerformanceRow>;

export type Scope = 'sector' | 'country' | 'instrument' | 'group';

/** Thrown when Supabase is not configured — callers fall back to bundled seed data. */
export class MarketUnavailableError extends Error {
  constructor() {
    super('Supabase is not configured; market data unavailable');
    this.name = 'MarketUnavailableError';
  }
}

/**
 * One scope + period slice of `market.performance`.
 *
 * `change_pct` is a PERCENT (-3.66 = -3.66%), already converted from the provider's
 * fraction by the edge function — matching `taxonomy.ts`'s `changePct` so the two
 * sources are interchangeable in the UI.
 */
export async function fetchPerformance(scope: Scope, period: Period): Promise<PerformanceRow[]> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();

  const { data, error } = await supabase
    .schema('market')
    .from('performance')
    .select('scope,scope_id,period,change_pct,as_of,stale_after,source')
    .eq('scope', scope)
    .eq('period', period);

  if (error) throw new Error(`market.performance read failed: ${error.message}`);
  return parseArray(zPerformanceRow, data ?? [], 'market.performance');
}

/**
 * Ask the edge function to refresh a resource. Fire-and-forget by design: the read
 * path must never block on OpenBB, so callers refetch on success and simply keep
 * showing the stale rows if it fails.
 */
export async function triggerRefresh(resource: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.functions.invoke('market-refresh', { body: { resource } });
  if (error) throw new Error(`market-refresh(${resource}) failed: ${error.message}`);
}

/** True when every row has passed its `stale_after`, or there are no rows at all. */
export function isStale(rows: PerformanceRow[], now = Date.now()): boolean {
  if (rows.length === 0) return true;
  return rows.every((r) => new Date(r.stale_after).getTime() <= now);
}

/** The freshest `as_of` in a set of rows — what the UI shows as the data's age. */
export function latestAsOf(rows: PerformanceRow[]): Date | null {
  let newest: number | null = null;
  for (const r of rows) {
    const t = new Date(r.as_of).getTime();
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest === null ? null : new Date(newest);
}
