import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '@/lib/cn';
import { StatusDot, type DotStatus } from './status-dot';

/**
 * The vertical connector that binds timeline rows into one run.
 *
 * Geometry follows the pattern already proven in `conversation.tsx`: a single absolute
 * 2px line running from just under the marker to below the row box, so it bridges the
 * inter-row gap and stops at the last row. Drawing it from the marker DOWN (rather than
 * as two halves around the marker) means it never needs an opaque background behind the
 * marker — which is what would otherwise break the moment a row sat on a `crust` card
 * instead of the app background.
 *
 * Three separate copies of this line existed before, each with its own offsets.
 */
/**
 * One collapsed row's first line: `py-1.5` (6 top + 6 bottom) around a 16px text line.
 * The marker box is this tall so the dot centres on the LABEL, and the rail starts where
 * the marker box ends. Rows are NOT a fixed height — a `running`/`failed` badge is ~26px
 * and makes its row taller — which is why the row anchors its label to the top
 * (`items-start` in `NodeRow`) rather than centring it: centred, the label slid down as
 * ornaments were added while the dot stayed put, and the spine visibly drifted (3px on a
 * plain row, 8px on a badge row).
 */
const ROW_FIRST_LINE = 28;

/** `StatusDot`'s default diameter — the rail is positioned off the marker, not guessed. */
const DOT = 18;

/** `FanHeader`'s first line: `pt-0.5` (2) around a 14px label line → its centre is 9. */
const FAN_FIRST_LINE = 18;

const RAIL = {
  position: 'absolute' as const,
  // Start 1px inside the dot's lower edge so the line meets the marker with no seam,
  // and run 14px past the row to bridge the inter-row gap into the next dot. Derived
  // from the marker geometry: nudge `ROW_FIRST_LINE` and the rail follows.
  top: ROW_FIRST_LINE / 2 + DOT / 2 - 1,
  bottom: -14,
  width: 2,
};

/**
 * The rail segment below a row. On the branch that is currently running it breathes, so
 * the eye is drawn down the spine to where the work actually is — the one place on a
 * long timeline that is still changing.
 */
function Rail({ active }: { active?: boolean }) {
  const pulse = useSharedValue(1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!active || reduced) return;
    pulse.value = withRepeat(withTiming(0.35, { duration: 900 }), -1, true);
  }, [active, reduced, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: active ? pulse.value : 1 }));
  return (
    <Animated.View
      style={[RAIL, style]}
      className={active ? 'bg-butter-400' : 'bg-frosting-200 dark:bg-night-border'}
    />
  );
}

export function SpineRow({
  status,
  last,
  gutter = 26,
  marker,
  children,
  className,
}: {
  status?: DotStatus;
  /** Suppresses the downward rail — the last row of a spine. */
  last?: boolean;
  gutter?: number;
  /** Replaces the status marker (a sub-agent avatar, a tool glyph). */
  marker?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn('flex-row', className)}>
      <View style={{ width: gutter }} className="items-center">
        {!last ? <Rail active={status === 'active'} /> : null}
        <View style={{ height: ROW_FIRST_LINE }} className="z-10 items-center justify-center">
          {marker ?? <StatusDot status={status} />}
        </View>
      </View>
      <View className="min-w-0 flex-1">{children}</View>
    </View>
  );
}

/**
 * The bracket around one superstep's parallel members.
 *
 * Parallelism is the thing the previous tree could not express at all — it flattened
 * every superstep into one list, so ten workers running at once and ten running in
 * sequence drew identically. A doubled left rail plus a header chip is deliberately a
 * *different shape* from the single-rail sequential spine, so the distinction survives
 * a glance. It stacks members vertically rather than side by side because a fan can be
 * 19 wide (council) and still has to read on a phone.
 */
export function ParallelFan({ header, last, children }: { header: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <View className="flex-row">
      <View style={{ width: 26 }} className="items-center">
        {/* Same rule as SpineRow: the diamond centres on the header's FIRST LINE
            (`FanHeader` is `pt-0.5` + a 14px label line, so 2 + 7 = 9), not on a box
            sized independently of it — at 26 tall it centred at 13 and sat visibly
            below its own "N in parallel" label. */}
        {!last ? <View style={{ ...RAIL, top: FAN_FIRST_LINE }} className="bg-frosting-200 dark:bg-night-border" /> : null}
        <View style={{ height: FAN_FIRST_LINE }} className="z-10 w-full items-center justify-center">
          <View className="h-2.5 w-2.5 rotate-45 rounded-[3px] border-2 border-frosting-300 bg-dough dark:border-night-border dark:bg-night-bg" />
        </View>
      </View>
      <View className="min-w-0 flex-1 gap-1.5 pb-2">
        {header}
        <View className="gap-1.5 border-l-[3px] border-frosting-200 pl-2.5 dark:border-night-border">{children}</View>
      </View>
    </View>
  );
}
