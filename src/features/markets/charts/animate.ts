/**
 * The animation pattern for charts, established once.
 *
 * Nothing in this app animated SVG before this file, so the conventions here are the ones every
 * later chart follows. Reanimated 4.3.1 and react-native-svg 15.13 are both already dependencies.
 *
 * TWO RULES THAT ARE EASY TO GET WRONG:
 *
 * **`createAnimatedComponent` BELONGS AT MODULE SCOPE.** Called inside a component it returns a NEW
 * component type on every render, and React unmounts and remounts the whole subtree when a type
 * changes — so an animation that looks merely janky is actually the tree being destroyed sixty
 * times a second. They are created once, here, and imported.
 *
 * **REDUCED MOTION IS NOT AN OPTIONAL EXTRA.** `useReducedMotion()` reads the OS accessibility
 * setting on all three platforms; when it is on, entrance progress is 1 immediately. That is a
 * jump to the FINAL state, never a skipped render — a viewer who asked for less motion still gets
 * the whole chart.
 *
 * WHY THE DONUT SPINS VIA A CONTAINER TRANSFORM, NOT AN ANIMATED ARC. Sweeping a donut open means
 * animating each arc's `d`, which means generating the path on the UI thread — and d3-shape's
 * `arc()` is a closure, not a worklet, so it cannot run there. Rotating and fading the whole group
 * is a transform on a plain `Animated.View`: identical on web, iOS and Android, no SVG prop
 * animation at all, and it reads exactly as "appearing from a spin". The dash-offset helper below
 * is the counterpart for line charts, where the geometry is fixed and only the reveal moves.
 */
import { useEffect } from 'react';
import { Path, Circle, G } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/** Animated SVG primitives. Created ONCE — see the header. */
export const AnimatedPath = Animated.createAnimatedComponent(Path);
export const AnimatedCircle = Animated.createAnimatedComponent(Circle);
export const AnimatedG = Animated.createAnimatedComponent(G);

/** The app's entrance feel: a soft settle rather than a bounce, matching the bakery vibe. */
export const ENTRANCE = { duration: 620, easing: Easing.out(Easing.cubic) } as const;

/**
 * A 0 -> 1 entrance progress that respects reduced motion.
 *
 * `key` restarts the animation when the subject changes — switching from Amazon to Alphabet should
 * redraw, not sit at the previous chart's final frame.
 */
export function useEntrance(key: string | number = 0, enabled = true): SharedValue<number> {
  const progress = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!enabled) return;
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, ENTRANCE);
  }, [key, enabled, reduced, progress]);

  return progress;
}

/**
 * Draw a stroked path on, for line charts.
 *
 * `length` must be the path's own length. There is no `getTotalLength` in react-native-svg on every
 * platform, so callers pass a computed or generously over-estimated length — an over-estimate
 * finishes the reveal early, which is invisible, while an under-estimate leaves the line clipped.
 */
export function useDrawOn(progress: SharedValue<number>, length: number) {
  return useAnimatedProps(() => ({
    strokeDasharray: [length, length],
    strokeDashoffset: length * (1 - progress.value),
  }));
}
