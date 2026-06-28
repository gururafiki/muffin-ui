import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Card, Chip, Text } from '@/components/ui';
import {
  allocationByAccount,
  allocationByAssetType,
  formatMoney,
  type Account,
  type AllocationSlice,
} from './portfolio';

const COLORS = ['#875DAE', '#A47EC6', '#6E63A6', '#E9A94D', '#C2A4DC', '#6F4A93', '#7FB35C', '#524785', '#B79AD8'];

function Row({ slice, total, color, currency }: { slice: AllocationSlice; total: number; color: string; currency: string }) {
  const frac = total ? slice.value / total : 0;
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(frac, { duration: 500 });
  }, [frac, w]);
  const barStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));

  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View style={{ backgroundColor: color }} className="h-2.5 w-2.5 rounded-full" />
          <Text variant="body">{slice.label}</Text>
        </View>
        <Text variant="muted">
          {formatMoney(slice.value, currency)} · {Math.round(frac * 100)}%
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-pill bg-crust dark:bg-night-surface-muted">
        <Animated.View style={[{ height: '100%', backgroundColor: color }, barStyle]} />
      </View>
    </View>
  );
}

/** Allocation of assets by asset type or by account, with animated bars. */
export function AllocationBars({ accounts, currency }: { accounts: Account[]; currency: string }) {
  const [mode, setMode] = useState<'asset' | 'account'>('asset');
  const slices = mode === 'asset' ? allocationByAssetType(accounts) : allocationByAccount(accounts);
  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="heading">Allocation</Text>
        <View className="flex-row gap-2">
          <Chip label="By asset" active={mode === 'asset'} onPress={() => setMode('asset')} />
          <Chip label="By account" active={mode === 'account'} onPress={() => setMode('account')} />
        </View>
      </View>
      <View className="gap-2">
        {slices.map((s, i) => (
          <Row key={s.key} slice={s} total={total} color={COLORS[i % COLORS.length]} currency={currency} />
        ))}
      </View>
    </Card>
  );
}
