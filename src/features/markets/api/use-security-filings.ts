/**
 * The company's own filings — the documents, not the numbers inside them.
 *
 * `market.security_recent_filings` classifies each one server-side as `annual`, `interim` or
 * `event`, and that classification is the reason the view exists: a 10-K and an 8-K answer
 * different questions, and a company files dozens of 8-Ks a year against one 10-K, so a single
 * date-ordered list buries the annual report under a month of press releases.
 *
 * The `kind` also spans two vocabularies. A domestic registrant files 10-K/10-Q; a foreign private
 * issuer files 20-F/6-K INSTEAD. Reading `report_type` in the client would mean reimplementing that
 * rule here and getting to disagree with the server about what an annual report is.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zFiling = z.looseObject({
  accession_number: z.string(),
  filing_date: z.string().nullish(),
  report_type: z.string().nullish(),
  report_url: z.string().nullish(),
  filing_detail_url: z.string().nullish(),
  kind: z.string(),
});

export interface Filing {
  accession: string;
  filingDate: string | null;
  reportType: string | null;
  /** The rendered document where there is one, else SEC's index page for the submission. */
  url: string | null;
  kind: 'annual' | 'interim' | 'event' | string;
}

export function useSecurityFilings(securityId: string | null | undefined, limit = 12) {
  const query = useQuery({
    queryKey: ['market', 'security-filings', securityId ?? null, limit],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_recent_filings')
        .select('accession_number,filing_date,report_type,report_url,filing_detail_url,kind')
        .eq('security_id', securityId as string)
        .order('filing_date', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`market.security_recent_filings read failed: ${error.message}`);
      return parseArray(zFiling, data ?? [], 'security_recent_filings');
    },
    enabled: !!securityId,
    // A filing never changes once made; only new ones arrive, and the resource re-reads weekly.
    staleTime: 12 * 60 * 60_000,
    gcTime: 48 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const filings: Filing[] = (query.data ?? []).map((r) => ({
    accession: r.accession_number,
    filingDate: r.filing_date ?? null,
    reportType: r.report_type ?? null,
    // The rendered document first, SEC's index page as the fallback: `report_url` is null on some
    // submissions and a dead link is worse than a link to the index that certainly resolves.
    url: r.report_url ?? r.filing_detail_url ?? null,
    kind: r.kind,
  }));

  return {
    filings,
    // Separated here rather than by the caller, so "periodic" means one thing in the app.
    periodic: filings.filter((f) => f.kind !== 'event'),
    events: filings.filter((f) => f.kind === 'event'),
    loading: query.isPending && !!securityId,
    // SEC-only: most of the universe has no CIK and therefore no filings. Ordinary, not a fault.
    empty: !query.isPending && filings.length === 0,
  };
}
