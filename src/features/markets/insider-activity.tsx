/**
 * Whether the people who know most about this company have been buying or selling.
 *
 * PEOPLE FIRST, SHARES SECOND, AND THAT ORDER IS THE POINT. One officer exercising a large option
 * grant can outweigh a dozen colleagues buying; a net share figure alone would call that "insiders
 * sold" — arithmetically right and factually misleading. So the headline is how many distinct
 * people were on each side, and the share balance is shown beneath it as supporting detail.
 *
 * NO VERDICT IS OFFERED. Insider selling has a dozen innocent explanations — scheduled 10b5-1
 * plans, tax withholding on vesting, diversification — and buying is the only side that carries a
 * conventional signal. Presenting a "bullish/bearish" badge would be an interpretation this data
 * does not support, so the section reports what happened and stops.
 */
import { View } from 'react-native';

import { Card, Text } from '@/components/ui';

import { useInsiderActivity } from './api/use-insider-activity';

/** 1,439 shares reads fine; 2,400,000 does not. */
function formatShares(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

function people(n: number): string {
  return n === 1 ? '1 person' : `${n} people`;
}

export function InsiderActivity({ securityId }: { securityId: string | null | undefined }) {
  const { activity, loading, empty } = useInsiderActivity(securityId);

  // Form 4 is SEC-only and plenty of filers go a quarter without a transaction — no section rather
  // than an empty one.
  if (loading || empty || !activity) return null;

  const { buyers, sellers, netShares, trades } = activity;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Insider activity</Text>
        <Text variant="muted">last 90 days</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        <View className="flex-row items-baseline justify-between">
          <Text variant="muted">Bought</Text>
          <Text variant="body">{people(buyers)}</Text>
        </View>
        <View className="flex-row items-baseline justify-between">
          <Text variant="muted">Sold</Text>
          <Text variant="body">{people(sellers)}</Text>
        </View>
        <View className="flex-row items-baseline justify-between">
          {/* Signed, and labelled by DIRECTION rather than by sign: "-2.4M net shares" makes the
              reader decode a minus sign to learn something the words can just say. */}
          <Text variant="muted">{netShares >= 0 ? 'Net bought' : 'Net sold'}</Text>
          <Text variant="body">{`${formatShares(Math.abs(netShares))} shares`}</Text>
        </View>
        <Text variant="muted">
          {`${trades} transaction${trades === 1 ? '' : 's'} reported on Form 4. Selling is often scheduled or for tax, and is not a signal on its own.`}
        </Text>
      </Card>
    </>
  );
}
