/**
 * A statement as a TABLE — line items down, periods across.
 *
 * Read from `market.security_metric_series`, not from `security_statement`'s jsonb. That matters:
 * the two statement providers share almost no field names (SEC and yfinance agree on 4 of 40 income
 * lines, and pre-tax income is `total_pretax_income` on one and `total_pre_tax_income` on the
 * other), so any client picking keys out of the raw payload would be carrying a second copy of the
 * `metric_source_field` catalogue and would drift from it. The metric layer has already resolved
 * that, once, server-side.
 *
 * It also means all three statements work the same way: `category` selects which one, and the
 * catalogue supplies each line's display name and unit.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';
import type { PeriodType } from './use-security-metrics';

export type StatementCategory = 'income_statement' | 'balance_sheet' | 'cash_flow';

const zRow = z.looseObject({
  metric_code: z.string(),
  metric_name: z.string(),
  unit: z.string(),
  as_of: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce is the guard that keeps a driver which
  // quoted it from making parseArray drop every row and the table silently vanish.
  value: z.coerce.number(),
  currency_code: z.string().nullish(),
  is_derived: z.boolean().nullish(),
});

export interface StatementLine {
  code: string;
  name: string;
  unit: string;
  derived: boolean;
  /** One entry per period column, aligned by index; null where that period has no figure. */
  values: (number | null)[];
}

export interface StatementTable {
  /** Period end dates, most recent first — the column headers. */
  periods: string[];
  lines: StatementLine[];
  currency: string | null;
  loading: boolean;
  empty: boolean;
}

/** How many period columns a phone can show without becoming a spreadsheet. */
const COLUMNS = 4;

export function useStatementTable(
  symbol: string | undefined,
  category: StatementCategory,
  period: PeriodType = 'annual',
): StatementTable {
  const query = useQuery({
    queryKey: ['market', 'statement-table', symbol ?? null, category, period],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_metric_series')
        .select('metric_code,metric_name,unit,as_of,value,currency_code,is_derived')
        .eq('symbol', symbol as string)
        .eq('period_type', period)
        .eq('category', category)
        // Newest first so the `limit` drops the FAR PAST rather than an arbitrary middle. 600 is
        // well under `PGRST_DB_MAX_ROWS` (1,000) — a request above it is not an error here, just a
        // shorter answer, which would silently lose whole line items.
        .order('as_of', { ascending: false })
        .limit(600);
      if (error) throw new Error(`market.security_metric_series read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'security_metric_series');
    },
    enabled: !!symbol,
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];

  // The period columns: the most recent N, newest first.
  const periods = [...new Set(rows.map((r) => r.as_of))].sort().reverse().slice(0, COLUMNS);
  const index = new Map(periods.map((p, i) => [p, i]));

  const byMetric = new Map<string, StatementLine>();
  for (const r of rows) {
    const col = index.get(r.as_of);
    if (col === undefined) continue;
    let line = byMetric.get(r.metric_code);
    if (!line) {
      line = {
        code: r.metric_code,
        name: r.metric_name,
        unit: r.unit,
        derived: !!r.is_derived,
        values: Array.from({ length: periods.length }, () => null),
      };
      byMetric.set(r.metric_code, line);
    }
    line.values[col] = r.value;
  }

  // A LINE WITH NO FIGURE IN ANY SHOWN PERIOD IS DROPPED. The catalogue lists what the system can
  // hold, not what this filer reports — printing "Research and development" with four blanks under
  // it for a bank reads as a broken table rather than as a company without an R&D line.
  const lines = [...byMetric.values()].filter((l) => l.values.some((v) => v !== null));

  return {
    periods,
    lines,
    // Every line of one statement is in one currency; any row that states it names the lot.
    currency: rows.find((r) => r.currency_code)?.currency_code ?? null,
    loading: query.isPending && !!symbol,
    empty: !query.isPending && lines.length === 0,
  };
}
