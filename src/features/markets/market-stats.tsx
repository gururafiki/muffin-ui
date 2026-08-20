/**
 * Float, ownership, short interest and the analyst consensus.
 *
 * TWO UNIT TRAPS, BOTH LIVE IN THIS FILE. The server stores what the provider sent and names the
 * unit rather than converting, so the conversion happens once, here:
 *
 *   * ownership and short interest are FRACTIONS — 0.66482 is 66.482%, and rendering it raw shows
 *     a company two thirds institutionally owned as "0.66%";
 *   * `recommendation_mean` is a 1..5 scale where LOWER IS MORE BULLISH (2.11 beside "buy"), so it
 *     is not shown as a score at all — the provider's own word is.
 *
 * And a price target is MONEY: a Korean consensus of 470,155.62 without its currency renders as
 * "$470,155".
 */
import { View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';

import { useMarketStats } from './api/use-market-stats';
import { formatMoney } from './money';

const pct = (fraction: number | null) =>
  fraction === null ? null : `${(fraction * 100).toFixed(fraction < 0.01 ? 2 : 1)}%`;

const shares = (n: number | null) => {
  if (n === null) return null;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString('en-US');
};

/** A recommendation is a word, not a number — see the note above about the 1..5 scale. */
const RECOMMENDATION_TONE: Record<string, 'bullish' | 'bearish' | 'neutral'> = {
  strong_buy: 'bullish',
  buy: 'bullish',
  hold: 'neutral',
  sell: 'bearish',
  strong_sell: 'bearish',
};

function Row({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <View className="flex-row items-baseline justify-between">
      <Text variant="muted" className="flex-1 pr-3 text-xs">
        {label}
      </Text>
      <Text variant="body" className="text-xs">
        {value}
      </Text>
    </View>
  );
}

export function MarketStats({ securityId }: { securityId: string | undefined }) {
  const { stats, estimate, loading } = useMarketStats(securityId);

  // No card at all rather than an empty one, while loading or when the backlogs have not reached
  // this security — the rule the macro panel and the price chart already follow.
  if (loading || (!stats && !estimate)) return null;

  const rec = estimate?.recommendation ?? null;
  const tone = rec ? (RECOMMENDATION_TONE[rec] ?? 'neutral') : 'neutral';

  return (
    <View className="mt-5 gap-2">
      <Text variant="heading">Market data</Text>
      <Card tone="muted" className="gap-1">
        {stats ? (
          <>
            <Row label="Shares outstanding" value={shares(stats.outstandingShares)} />
            <Row label="Free float" value={shares(stats.floatShares)} />
            <Row label="Held by institutions" value={pct(stats.institutionOwnership)} />
            <Row label="Held by insiders" value={pct(stats.insiderOwnership)} />
            <Row label="Short interest (of float)" value={pct(stats.shortPercentOfFloat)} />
            <Row
              label="Days to cover"
              value={stats.daysToCover === null ? null : stats.daysToCover.toFixed(2)}
            />
          </>
        ) : null}

        {estimate ? (
          <>
            <Row
              label={`Analyst target${estimate.analysts ? ` (${estimate.analysts})` : ''}`}
              value={
                estimate.targetConsensus === null
                  ? null
                  : formatMoney(estimate.targetConsensus, estimate.currency)
              }
            />
            <Row
              label="Target range"
              value={
                estimate.targetLow === null || estimate.targetHigh === null
                  ? null
                  : `${formatMoney(estimate.targetLow, estimate.currency)} – ${formatMoney(
                      estimate.targetHigh,
                      estimate.currency,
                    )}`
              }
            />
            {rec ? (
              <View className="flex-row items-baseline justify-between pt-1">
                <Text variant="muted" className="text-xs">
                  Consensus
                </Text>
                <Badge label={rec.replace('_', ' ')} tone={tone} />
              </View>
            ) : null}
          </>
        ) : null}
      </Card>
    </View>
  );
}
