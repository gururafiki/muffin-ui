/**
 * Growth per TIER / region group, from each group's proxy ETF.
 *
 * `market.classification_groups.etf` already named them (MSCI developed = URTH, emerging = EEM;
 * FTSE developed = VEA), so the server needed no new reference data — only the same batched price
 * call the countries use.
 *
 * `scope_id` is `<scheme>:<group>`, NOT the bare group id, because a group id is not unique across
 * schemes: MSCI and FTSE both have `developed`, and they are different funds precisely because the
 * two providers disagree about which countries belong. Reading it by the bare id would show FTSE's
 * number on an MSCI page.
 *
 * The World Bank scheme has no ETFs — income bands are not investable — so its groups have no row
 * and correctly show no number rather than borrowing one.
 */
import { useQuery } from '@tanstack/react-query';

import { fetchPerformance, latestAsOf, MarketUnavailableError } from './market-client';
import type { Period } from './periods';

export interface GroupPerformance {
  /** Percent change for the requested group, or null when the scheme has no proxy fund. */
  changePct: number | null;
  asOf: Date | null;
  source: string | null;
  sample: boolean;
}

export function useGroupPerformance(
  schemeId: string,
  groupId: string,
  period: Period,
): GroupPerformance {
  const query = useQuery({
    queryKey: ['market', 'performance', 'group', period],
    queryFn: () => fetchPerformance('group', period),
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const row = rows.find((r) => r.scope_id === `${schemeId}:${groupId}`);
  return {
    changePct: row?.change_pct ?? null,
    asOf: latestAsOf(rows),
    source: row?.source ?? null,
    // No row is not "sample" — it means this group has no investable proxy (World Bank income
    // bands), so the page shows nothing rather than an authored stand-in.
    sample: false,
  };
}
