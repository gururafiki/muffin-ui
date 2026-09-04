/**
 * Recent articles for a security — `market.security_news`, 1,216 rows nothing read.
 *
 * THE ASSOCIATION IS THE PROVIDER'S, NOT OURS, AND THE UI MUST SAY SO. yfinance returned a **Waymo**
 * story under AAPL. We store what the provider associated with the symbol; presenting it as "news
 * about this company" would be asserting an editorial judgement we did not make and cannot check.
 *
 * Retention is 90 days server-side and articles are shared across securities (88 of 877 were
 * attached to more than one), so this is a recent-activity panel, not an archive.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zArticle = z.looseObject({
  url: z.string(),
  title: z.string(),
  published_at: z.string(),
  source: z.string().nullish(),
  summary: z.string().nullish(),
});

export interface NewsArticle {
  url: string;
  title: string;
  publishedAt: string;
  source: string | null;
  summary: string | null;
}

export function useSecurityNews(symbol: string | undefined, limit = 12) {
  const query = useQuery({
    queryKey: ['market', 'security-news', symbol ?? null, limit],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_news')
        .select('url,title,published_at,source,summary')
        .eq('symbol', symbol as string)
        .order('published_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`market.security_news read failed: ${error.message}`);
      return parseArray(zArticle, data ?? [], 'security_news');
    },
    enabled: !!symbol,
    staleTime: 30 * 60_000,
    gcTime: 6 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const articles: NewsArticle[] = rows.map((r) => ({
    url: r.url,
    title: r.title,
    publishedAt: r.published_at,
    source: r.source ?? null,
    summary: r.summary ?? null,
  }));
  return {
    articles,
    loading: query.isPending && !!symbol,
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while the id is null — and the section then
    // renders a card with a heading and nothing under it, which is the one thing this page's
    // convention forbids. Seen in a browser with the instrument unresolved: every section on the
    // stock page drew an empty card at once. `loading` already guards on the id; `empty` must too.
    empty: !(query.isPending && !!symbol) && rows.length === 0,
  };
}
