import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';

/**
 * Determinate progress bar (`value` 0..1). The fill eases toward `value` with a
 * `scaleX` transform (off the layout pass — same idiom as the wealth bars), so
 * it stays smooth even when the value is nudged on a tick. Pass `animate={false}`
 * (e.g. under reduce-motion) to set the fill directly with no tween. Size/round
 * the track via `className`.
 */
export function ProgressBar({
  value,
  animate = true,
  className,
  accessibilityLabel,
}: {
  value: number;
  animate?: boolean;
  className?: string;
  accessibilityLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const scale = useSharedValue(clamped);
  useEffect(() => {
    scale.value = animate
      ? withTiming(clamped, { duration: 400, easing: Easing.out(Easing.cubic) })
      : clamped;
  }, [clamped, animate, scale]);
  // scaleX, not width — transforms animate off the layout pass.
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      accessibilityLabel={accessibilityLabel}
      className={cn('h-2 overflow-hidden rounded-pill bg-frosting-100 dark:bg-night-surface-muted', className)}>
      <Animated.View
        style={[
          { height: '100%', width: '100%', backgroundColor: palette.frosting[500], transformOrigin: 'left' },
          barStyle,
        ]}
      />
    </View>
  );
}
