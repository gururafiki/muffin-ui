/**
 * Dividends and splits.
 *
 * The dividend figure is a PER-SHARE amount, so it uses `formatPerShare` rather than `formatMoney`:
 * the latter drops decimals below a million (correct on a $4.57T market cap) and would render a
 * $1.2087 dividend as "$1" and a sub-cent one as "$0". And the currency comes from the SECURITY,
 * because the table stores a bare number — a dividend is paid in the currency its listing trades
 * in, and with no currency known the amount is left unlabelled rather than assumed to be dollars.
 *
 * A SPLIT IS A RATIO, NOT MONEY. `value: 20` is Amazon's 20-for-1 — running it through a currency
 * formatter would print "$20", which is a plausible-looking share price rather than a split.
 */
import { View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';

import { useSecurityActions } from './api/use-security-actions';
import { formatPerShare } from './money';

/** How many to show before it stops being a summary. Dividends run to decades. */
const SHOWN = 8;

export function CorporateActions({
  securityId,
  currency,
}: {
  securityId: string | null | undefined;
  currency: string | null | undefined;
}) {
  const { dividends, splits, loading, empty } = useSecurityActions(securityId);

  // NOTHING AT ALL RENDERS NOTHING — a company that has never paid a dividend gets no section
  // rather than an empty frame headed "Dividends", which reads as a broken feature.
  if (loading || empty) return null;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Dividends & splits</Text>
        {dividends.length > SHOWN ? (
          <Text variant="muted">{`${dividends.length} payments`}</Text>
        ) : null}
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        {splits.slice(0, 3).map((s) => (
          <View key={`split-${s.exDate}`} className="flex-row items-baseline justify-between">
            <Text variant="muted" className="flex-1 pr-3">
              {s.exDate}
            </Text>
            <Badge label="split" tone="neutral" />
            {/* A ratio, deliberately never through a money formatter. */}
            <Text variant="body" className="ml-2">{`${s.value}-for-1`}</Text>
          </View>
        ))}
        {dividends.slice(0, SHOWN).map((d) => (
          <View key={`div-${d.exDate}`} className="flex-row items-baseline justify-between">
            <Text variant="muted" className="flex-1 pr-3">
              {d.exDate}
            </Text>
            <Text variant="body">{formatPerShare(d.value, currency)}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}
