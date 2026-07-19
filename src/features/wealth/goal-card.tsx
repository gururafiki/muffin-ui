import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { formatMoney, goalProgress, type Goal } from './portfolio';

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

export function GoalCard({
  goal,
  currency,
  onPress,
}: {
  goal: Goal;
  currency: string;
  onPress?: () => void;
}) {
  const progress = goalProgress(goal);
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withTiming(progress, { duration: 700 });
  }, [progress, scale]);
  // scaleX, not width — transforms animate off the layout pass.
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));
  const date = fmtDate(goal.targetDate);

  return (
    <Pressable onPress={onPress} disabled={!onPress} className="active:opacity-80">
      <Card tone="sticker" className="gap-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Icon name={goal.icon} size={22} color={palette.frosting[600]} />
            <Text variant="heading">{goal.name}</Text>
          </View>
          <Text variant="heading" style={{ color: palette.frosting[600] }}>
            {Math.round(progress * 100)}%
          </Text>
        </View>
        <View className="h-3 overflow-hidden rounded-pill bg-crust dark:bg-night-surface-muted">
          <Animated.View style={[{ height: '100%', width: '100%', backgroundColor: palette.frosting[500], transformOrigin: 'left' }, barStyle]} />
        </View>
        <View className="flex-row items-center justify-between">
          <Text variant="muted">
            {formatMoney(goal.currentAmount, currency)} of {formatMoney(goal.targetAmount, currency)}
          </Text>
          {date ? <Text variant="muted">by {date}</Text> : null}
        </View>
      </Card>
    </Pressable>
  );
}
