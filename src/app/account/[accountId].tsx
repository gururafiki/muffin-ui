import { Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Screen, Text } from '@/components/ui';
import { changeTone } from '@/features/markets/taxonomy';
import { palette } from '@/theme/colors';
import { AddHoldingForm } from '@/features/wealth/add-holding-form';
import {
  accountTypeMeta,
  accountValue,
  assetForSymbol,
  formatMoney,
  holdingValue,
} from '@/features/wealth/portfolio';
import { useWealth } from '@/features/wealth/store';

const toneColor = { bullish: palette.bullish, bearish: palette.bearish, neutral: palette.neutral };

export default function AccountScreen() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const account = useWealth((s) => s.accounts.find((a) => a.id === accountId));
  const removeHolding = useWealth((s) => s.removeHolding);
  const currency = useWealth((s) => s.baseCurrency);

  if (!account) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown account</Text>
        </Card>
      </Screen>
    );
  }

  const meta = accountTypeMeta(account.type);

  return (
    <Screen>
      <Stack.Screen options={{ title: account.name }} />

      <Card tone="sticker" className="mt-1 gap-2">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
            <Icon name={meta.icon} size={26} color={palette.frosting[600]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{account.name}</Text>
            <Badge label={meta.name} tone="info" />
          </View>
        </View>
        <Text variant="display">{formatMoney(accountValue(account), currency)}</Text>
        <Text variant="muted">{meta.blurb}</Text>
      </Card>

      {meta.holdings ? (
        <>
          <Text variant="label" className="mt-5">
            Holdings
          </Text>
          <View className="mt-2 gap-2">
            {account.holdings.length === 0 ? (
              <Text variant="muted">No holdings yet — add one below.</Text>
            ) : (
              account.holdings.map((h) => {
                const asset = assetForSymbol(h.symbol);
                return (
                  <Card key={h.id} className="flex-row items-center gap-3">
                    <View className="flex-1">
                      <Text variant="heading">{h.symbol}</Text>
                      <Text variant="muted">
                        {asset?.name ?? 'Holding'} · {h.units} @ {formatMoney(h.price, currency)}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text variant="heading">{formatMoney(holdingValue(h), currency)}</Text>
                      {typeof asset?.changePct === 'number' ? (
                        <Text style={{ color: toneColor[changeTone(asset.changePct)] }} className="text-xs font-semibold">
                          {asset.changePct >= 0 ? '+' : ''}
                          {asset.changePct.toFixed(1)}%
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${h.symbol}`}
                      onPress={() => removeHolding(account.id, h.id)}
                      hitSlop={8}>
                      <Icon name="close" size={18} color={palette.frosting[400]} weight="bold" />
                    </Pressable>
                  </Card>
                );
              })
            )}
          </View>

          <View className="mt-4">
            <AddHoldingForm accountId={account.id} />
          </View>
        </>
      ) : (
        <Card tone="muted" className="mt-4">
          <Text variant="muted">
            {meta.kind === 'liability' ? 'A liability tracked at its balance.' : 'A balance-based account.'}
          </Text>
        </Card>
      )}
    </Screen>
  );
}
