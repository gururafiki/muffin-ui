/**
 * Everything a tracked fund holds.
 *
 * The universe IS the union of the tracked funds' holdings, so this is the page that makes that
 * visible: a person arrives from a stock ("held by XLK") and sees what else sits beside it.
 *
 * WEIGHTS ARE AS FILED. A fund's weights do not sum to 100 — EWT's own N-PORT sums to 110.38 — so
 * they are shown as the fund reported them rather than renormalised into shares of a whole the
 * filing does not describe. N-PORT is filed ~60 days in arrears, so `as of` is always on screen.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Badge, Card, Screen, Text } from '@/components/ui';
import { useFundHoldings } from '@/features/markets/api/use-fund-holdings';

export default function FundScreen() {
  const params = useLocalSearchParams<{ fundSymbol: string }>();
  const router = useRouter();
  const symbol = String(params.fundSymbol ?? '').toUpperCase();
  const { items, asOf, loading } = useFundHoldings(symbol);
  const [q, setQ] = useState('');

  // Filtered on the CLIENT because the page already holds the fund's holdings — a round trip per
  // keystroke would be slower and no more correct.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (h) =>
        h.name?.toLowerCase().includes(needle) ||
        h.symbol?.toLowerCase().includes(needle) ||
        h.country?.toLowerCase().includes(needle),
    );
  }, [items, q]);

  return (
    <Screen>
      <Stack.Screen options={{ title: symbol }} />
      <Text variant="display" className="pt-4">{symbol}</Text>
      <View className="mt-1 flex-row items-center gap-2">
        <Text variant="muted" className="flex-1">
          {loading ? 'Loading holdings…' : `${items.length} holdings`}
        </Text>
        {asOf ? (
          <Text variant="muted" className="text-xs">as filed {asOf.toISOString().slice(0, 10)}</Text>
        ) : null}
      </View>

      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search this fund"
        accessibilityLabel="Search holdings"
        className="mt-3 rounded-bun border border-frosting-300 px-3 py-2 text-ink dark:border-frosting-700 dark:text-frosting-100"
        placeholderTextColor="#9aa0aa"
      />

      {!loading && items.length === 0 ? (
        <Card tone="muted" className="mt-4">
          <Text variant="label">Holdings</Text>
          <Text className="mt-1 text-ink-muted">No holdings on file for {symbol}.</Text>
          <Text className="mt-2 text-xs text-ink-soft">
            Holdings come from the fund&apos;s SEC N-PORT filing. A fund that has not filed — or is
            not an N-PORT filer at all, like a commodity trust — has nothing to show here.
          </Text>
        </Card>
      ) : null}

      <View className="mt-3 gap-2">
        {shown.map((h) => (
          <Pressable
            key={h.securityId}
            accessibilityRole="button"
            accessibilityLabel={`Open ${h.name ?? h.symbol ?? 'security'}`}
            disabled={!h.symbol}
            onPress={() =>
              h.symbol
                ? router.push({ pathname: '/stock/[ticker]', params: { ticker: h.symbol } })
                : undefined
            }
          >
            <Card className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text numberOfLines={1}>{h.name ?? h.symbol ?? 'Unnamed'}</Text>
                <View className="mt-1 flex-row flex-wrap gap-2">
                  {/* A security with no symbol is NOT tappable and says so by omission — the app
                      has no page to show for something it cannot price. */}
                  {h.symbol ? <Badge label={h.symbol} tone="info" /> : null}
                  {h.country ? <Badge label={h.country} tone="info" /> : null}
                  {h.type && h.type !== 'equity' ? <Badge label={h.type} tone="neutral" /> : null}
                </View>
              </View>
              {h.weightPct != null ? (
                <Text variant="heading">{h.weightPct.toFixed(2)}%</Text>
              ) : null}
            </Card>
          </Pressable>
        ))}
      </View>

      {q && shown.length === 0 && items.length > 0 ? (
        <Text variant="muted" className="mt-4">Nothing in {symbol} matches “{q}”.</Text>
      ) : null}
    </Screen>
  );
}
