import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '@/lib/cn';
import { Text } from './text';

/**
 * How long a step took, as a label plus a bar proportional to the longest step in the
 * same run.
 *
 * A relative bar rather than a time axis: LangGraph persists one timestamp per
 * superstep, so every member of a fan-out shares a start and an end. A true Gantt would
 * therefore draw ten identical bars and imply a precision that does not exist, whereas
 * "this step took most of the run" is both true and the thing a reader actually wants —
 * a 22-minute criteria run is 16 minutes of ticker classification, and that should be
 * visible without reading a single number.
 *
 * Bars are square-rooted so a step taking 1% of the run is still visible instead of
 * collapsing to nothing next to the dominant one.
 */
export function DurationBar({
  ms,
  maxMs,
  label,
  className,
}: {
  ms: number;
  maxMs: number;
  /** Preformatted duration (`formatDuration`) — this component does no formatting. */
  label: string;
  className?: string;
}) {
  const ratio = maxMs > 0 ? Math.min(1, Math.sqrt(ms / maxMs)) : 0;
  const grow = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    grow.value = reduced ? ratio : withTiming(ratio, { duration: 480 });
  }, [grow, ratio, reduced]);

  // scaleX, not width: keeps the growth off the layout pass, the same idiom as
  // `ProgressBar` and the wealth bars.
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: grow.value }] }));

  return (
    <View className={cn('flex-row items-center gap-1.5', className)}>
      <View className="h-1 w-14 overflow-hidden rounded-pill bg-frosting-100 dark:bg-night-surface-muted">
        <Animated.View
          style={[{ transformOrigin: 'left' }, style]}
          className="h-full w-full rounded-pill bg-frosting-300 dark:bg-frosting-500"
        />
      </View>
      <Text variant="muted" className="text-[11px] tabular-nums">
        {label}
      </Text>
    </View>
  );
}
