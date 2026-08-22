/**
 * Companies of a similar size in the same sector.
 *
 * NOT a curated peer set, and the UI must not call it one. `market.security_peers` computes sector
 * plus market-cap proximity — which is exactly what a vendor's "peers" endpoint returns, SAP.DE
 * coming back beside Micron and SK hynix. Doing it here costs no API calls and works for the whole
 * universe rather than for whichever symbols a free tier happens to cover.
 *
 * Sizes are in USD because they have to be comparable: `security.market_cap` is denominated in each
 * company's own currency, and ranking on it would put a ¥3tn company beside a $3bn one.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zPeer = z.looseObject({
  peer_id: z.string(),
  peer_name: z.string().nullish(),
  peer_symbol: z.string().nullish(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it.
  peer_market_cap_usd: z.coerce.number().nullish(),
  size_distance: z.coerce.number(),
});

export interface Peer {
  id: string;
  name: string | null;
  symbol: string | null;
  marketCapUsd: number | null;
}

export function usePeers(securityId: string | null | undefined, limit = 6) {
  const query = useQuery({
    queryKey: ['market', 'peers', securityId ?? null, limit],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_peers')
        .select('peer_id,peer_name,peer_symbol,peer_market_cap_usd,size_distance')
        .eq('security_id', securityId as string)
        // NEAREST IN SIZE, not largest. A sector's biggest companies are the same six names on
        // every page in it; the nearest ones are the comparison a reader is actually making.
        .order('size_distance')
        .limit(limit);
      if (error) throw new Error(`market.security_peers read failed: ${error.message}`);
      return parseArray(zPeer, data ?? [], 'security_peers');
    },
    enabled: !!securityId,
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const peers: Peer[] = (query.data ?? []).map((r) => ({
    id: r.peer_id,
    name: r.peer_name ?? null,
    symbol: r.peer_symbol ?? null,
    marketCapUsd: r.peer_market_cap_usd ?? null,
  }));

  return {
    peers,
    loading: query.isPending && !!securityId,
    // A security with no sector, or the only company in one, has no peers. Ordinary.
    empty: !query.isPending && peers.length === 0,
  };
}
