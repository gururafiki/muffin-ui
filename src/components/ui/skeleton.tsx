import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '@/lib/cn';

/**
 * Soft pulsing placeholder block — size it with className (`h-*`, `w-*`).
 * Used while a panel's data is still loading (thread hydration, list fetches)
 * so the layout keeps its shape instead of popping in all at once.
 *
 * **The `className` goes on an inner plain `View`, not on `Animated.View`.**
 * NativeWind classes do not reach a Reanimated `Animated.View` (the same caveat
 * `agent-hero.tsx` documents), so the previous version rendered an element with no
 * classes at all: no height, no background, no rounding. Every skeleton in the app was
 * an invisible zero-height box — verified in the browser, where the bars carried no
 * class attribute and their container measured 6px, i.e. the flex gaps alone. The
 * `Animated.View` now carries only the animated opacity, which IS a style.
 */
export function Skeleton({ className }: { className?: string }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.35, { duration: 800 }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View style={style}>
      <View className={cn('rounded-crumb bg-frosting-200 dark:bg-night-border', className)} />
    </Animated.View>
  );
}
