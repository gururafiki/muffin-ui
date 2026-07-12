import { useEffect } from 'react';
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
 */
export function Skeleton({ className }: { className?: string }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.35, { duration: 800 }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={style}
      className={cn('rounded-crumb bg-frosting-100 dark:bg-night-surface-muted', className)}
    />
  );
}
