import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { palette } from '@/theme/colors';

/**
 * The four states any unit of work can be in. Matches `RunStatus`
 * (`lib/agent/run-node.ts`) but stays a plain string union so `components/ui` keeps no
 * dependency on the agent layer.
 */
export type DotStatus = 'pending' | 'active' | 'done' | 'error';

/**
 * A soft halo that breathes under a running marker, so a live page always has
 * something moving without anything jumping. Reduce-motion gets the same ring, still.
 */
function Halo({ size }: { size: number }) {
  const pulse = useSharedValue(0.5);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value * 0.5, transform: [{ scale: 0.8 + pulse.value * 0.5 }] }));
  return (
    <Animated.View
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size }, style]}
      className="bg-butter-400"
    />
  );
}

/**
 * The single status marker for every timeline surface.
 *
 * Replaces three hand-rolled near-copies that had already drifted — the execution
 * tree's covered `error`, the run-progress one did not, and the council's used a third
 * set of sizes — so "what does a failed step look like?" had three answers.
 */
export function StatusDot({ status = 'pending', size = 18 }: { status?: DotStatus; size?: number }) {
  if (status === 'done') return <Icon name="check-circle" size={size} color={palette.leaf[500]} weight="fill" />;
  if (status === 'error') return <Icon name="warning" size={size} color={palette.bearish} weight="fill" />;
  if (status === 'active') {
    const core = Math.round(size * 0.55);
    return (
      <View style={{ width: size, height: size }} className="items-center justify-center">
        <Halo size={size} />
        <View style={{ width: core, height: core, borderRadius: core }} className="bg-butter-500" />
      </View>
    );
  }
  const ring = Math.round(size * 0.75);
  return (
    <View
      style={{ width: ring, height: ring, borderRadius: ring }}
      className="border-2 border-frosting-200 dark:border-night-border"
    />
  );
}

/** Word for a status, for badges and screen readers. */
export function statusLabel(status: DotStatus): string {
  return status === 'done' ? 'completed' : status === 'error' ? 'failed' : status === 'active' ? 'running' : 'pending';
}
