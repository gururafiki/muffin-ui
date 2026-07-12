import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { VoteTally } from './types';

const SEGMENTS: { key: keyof VoteTally; color: string; label: string }[] = [
  { key: 'bullish', color: palette.bullish, label: 'Bullish' },
  { key: 'neutral', color: palette.neutral, label: 'Hold' },
  { key: 'bearish', color: palette.bearish, label: 'Bearish' },
];

function Segment({ frac, color }: { frac: number; color: string }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(frac, { duration: 500 });
  }, [frac, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return <Animated.View style={[{ backgroundColor: color, height: '100%' }, style]} />;
}

/** Animated tally of the council's bull/hold/bear votes as they arrive. */
export function VoteBar({ tally, seats }: { tally: VoteTally; seats: number }) {
  const total = tally.bullish + tally.bearish + tally.neutral;
  const denom = Math.max(seats, total, 1);

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="label">Votes in</Text>
        <Text variant="muted">{total} / {denom}</Text>
      </View>
      <View className="h-3 flex-row overflow-hidden rounded-pill bg-crust dark:bg-night-surface-muted">
        {SEGMENTS.map((s) => (
          <Segment key={s.key} frac={total ? tally[s.key] / denom : 0} color={s.color} />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-3">
        {SEGMENTS.map((s) => (
          <View key={s.key} className="flex-row items-center gap-1.5">
            <View style={{ backgroundColor: s.color }} className="h-2.5 w-2.5 rounded-full" />
            <Text variant="muted">
              {s.label} {tally[s.key]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
