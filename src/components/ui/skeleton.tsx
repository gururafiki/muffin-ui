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

/**
 * Line-box heights for the `Text` variants a skeleton stands in for, measured from the
 * rendered app rather than guessed: `heading` (text-lg) 28px, body/`text-sm` 20px,
 * `text-xs` 16px.
 *
 * **A bar must occupy its line's full height, not the bar's own thickness.** A 14px bar
 * where a 20px line will land looks fine and still moves the page — the calls card measured
 * 86px as a skeleton against 108px filled, so every row grew by 22px. So each line is a box
 * of the real height with a thinner bar centred inside it: accurate layout, and the bar still
 * reads as a slim placeholder rather than a solid slab.
 */
const LINE = { heading: 'h-7', body: 'h-5', small: 'h-4' } as const;
const BAR = { heading: 'h-4', body: 'h-3.5', small: 'h-3' } as const;
type LineKind = keyof typeof LINE;

/** One text line: a correctly-sized box with a slimmer bar centred in it. */
function SkeletonLine({ kind = 'body', width }: { kind?: LineKind; width: string }) {
  return (
    <View className={cn('justify-center', LINE[kind])}>
      <Skeleton className={cn(BAR[kind], width)} />
    </View>
  );
}

/**
 * A paragraph's worth of bars, last line short — the shape prose loads into.
 *
 * Every skeleton in the app hand-rolled this stack, which is how they drifted from the markup
 * they stand in for. `lines` should match what the real content typically renders, because the
 * whole point is that filling it moves nothing.
 */
export function SkeletonText({
  lines = 3,
  kind = 'body',
  className,
}: {
  lines?: number;
  kind?: LineKind;
  className?: string;
}) {
  return (
    <View className={className}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} kind={kind} width={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </View>
  );
}

/**
 * The list-row shape: leading tile, a stack of text lines, and an optional trailing mark.
 *
 * `lines` and `trailing` exist because getting them wrong is exactly what makes a card grow
 * on fill — the calls list drew two lines where `CallCard` renders three, and a wide pill
 * where the real row ends in a narrow chevron, so every card jumped when data landed.
 * `trailing: 'chevron'` is the narrow mark; `'pill'` is a badge-width block.
 */
export function SkeletonRow({
  lines = 2,
  tile = 'h-12 w-12',
  gap = 'gap-1',
  trailing,
  className,
}: {
  lines?: number;
  /** Leading tile size — rows differ (calls uses 12, presets 10), so it is a class not a flag. */
  tile?: string;
  /** Must match the real row's column gap, or the card's height changes on fill. */
  gap?: string;
  trailing?: 'chevron' | 'pill';
  className?: string;
}) {
  return (
    <View className={cn('flex-row items-center gap-3', className)}>
      <Skeleton className={cn('rounded-crumb', tile)} />
      <View className={cn('flex-1', gap)}>
        {/* First line is a heading in every row that uses this; the rest are body/small.
            Sized as line BOXES so the row's height matches what it fills into. */}
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonLine
            key={i}
            kind={i === 0 ? 'heading' : i === 1 ? 'body' : 'small'}
            width={i === 0 ? 'w-40' : i === 1 ? 'w-24' : 'w-16'}
          />
        ))}
      </View>
      {trailing === 'chevron' ? <Skeleton className="h-5 w-2.5" /> : null}
      {trailing === 'pill' ? <Skeleton className="h-5 w-12 rounded-pill" /> : null}
    </View>
  );
}
