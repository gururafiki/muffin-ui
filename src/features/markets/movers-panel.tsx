import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { Freshness } from './freshness';
import { changeTone, sortMovers, type MoverItem } from './taxonomy';

const toneColor = { bullish: palette.bullish, bearish: palette.bearish, neutral: palette.neutral };

function fmt(pct: number) {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function MoverRow({
  item,
  maxAbs,
  onPress,
}: {
  item: MoverItem;
  maxAbs: number;
  onPress?: () => void;
}) {
  const color = toneColor[changeTone(item.changePct)];
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withTiming(maxAbs ? Math.abs(item.changePct) / maxAbs : 0, { duration: 500 });
  }, [item.changePct, maxAbs, scale]);
  // scaleX, not width — transforms animate off the layout pass.
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));

  return (
    <Pressable onPress={onPress} disabled={!onPress} className="gap-1 active:opacity-80">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-1.5">
          {item.icon ? <Icon name={item.icon} size={18} color={palette.frosting[500]} /> : null}
          <Text variant="body" numberOfLines={1} className="flex-1">
            {item.sublabel ? `${item.sublabel} ` : ''}
            {item.label}
          </Text>
        </View>
        <Text variant="body" style={{ color }} className="font-heading">
          {fmt(item.changePct)}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-pill bg-crust dark:bg-night-surface-muted">
        <Animated.View style={[{ height: '100%', width: '100%', backgroundColor: color, transformOrigin: 'left' }, barStyle]} />
      </View>
    </Pressable>
  );
}

/**
 * Best/worst movers with animated bars.
 *
 * Provenance is a PROP, not an assumption: panels fed from `market.performance`
 * show their age and source, panels still fed from the authored taxonomy show
 * "sample". Defaults to sample so a call site that has not been migrated yet cannot
 * accidentally present authored numbers as live.
 */
export function MoversPanel({
  title,
  items,
  count = 3,
  onSelect,
  sample = true,
  asOf,
  source,
  refreshing,
  right,
}: {
  title: string;
  items: MoverItem[];
  count?: number;
  onSelect?: (key: string) => void;
  sample?: boolean;
  asOf?: Date | null;
  source?: string | null;
  refreshing?: boolean;
  /** Extra control rendered under the header — e.g. the timeframe picker. */
  right?: React.ReactNode;
}) {
  const sorted = sortMovers(items);
  const best = sorted.slice(0, count);
  const worst = sorted.slice(-count).reverse().filter((w) => !best.includes(w));
  const maxAbs = Math.max(1, ...items.map((i) => Math.abs(i.changePct)));

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="heading">{title}</Text>
        <Freshness sample={sample} asOf={asOf} source={source} refreshing={refreshing} />
      </View>
      {right}

      <Text variant="label">Top performers</Text>
      <View className="gap-2">
        {best.map((m) => (
          <MoverRow key={m.key} item={m} maxAbs={maxAbs} onPress={onSelect && (() => onSelect(m.key))} />
        ))}
      </View>

      {worst.length > 0 ? (
        <>
          <Text variant="label">Laggards</Text>
          <View className="gap-2">
            {worst.map((m) => (
              <MoverRow key={m.key} item={m} maxAbs={maxAbs} onPress={onSelect && (() => onSelect(m.key))} />
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}
