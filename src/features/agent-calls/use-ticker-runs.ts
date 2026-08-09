/**
 * Past agent runs for one ticker.
 *
 * Rides the SAME `threads.search` the Calls tab makes — same query key, so opening a
 * stock page after the Calls tab costs no extra request and both stay in step. The
 * ticker already comes back on every thread via the search's `extract`
 * (`values.ticker`), so this is a filter, not a new server capability.
 *
 * WHY FILTER CLIENT-SIDE: `extract` pulls a value out of persisted state for
 * DISPLAY; it is not a queryable index, and `ticker` is in `values`, not in the
 * server-set `metadata` that search can filter on. Over the 50 most recent threads
 * that is exactly right — this panel is "recent work on this name", not an archive.
 * If it ever needs to be complete, the ticker has to be promoted into thread
 * metadata at run start, which is a muffin-agent change.
 */
import type { Thread } from '@langchain/langgraph-sdk';
import { useQuery } from '@tanstack/react-query';

import { searchThreads } from './threads';

/** The ticker the search extracted from this thread's state, if any. */
export function threadTicker(thread: Thread): string | undefined {
  const ex = (thread as { extracted?: Record<string, unknown> }).extracted;
  const t = ex?.ticker;
  return typeof t === 'string' && t.trim() ? t.trim().toUpperCase() : undefined;
}

export interface TickerRuns {
  runs: Thread[];
  loading: boolean;
  /** True when the thread list could not be read at all (offline, no API URL). */
  failed: boolean;
}

export function useTickerRuns(symbol: string): TickerRuns {
  const query = useQuery({
    // Deliberately the Calls tab's key — one fetch serves both.
    queryKey: ['threads'],
    queryFn: searchThreads,
    enabled: symbol.length > 0,
  });

  const wanted = symbol.toUpperCase();
  const runs = (query.data ?? []).filter((t) => threadTicker(t) === wanted);

  return { runs, loading: query.isPending && symbol.length > 0, failed: query.isError };
}
