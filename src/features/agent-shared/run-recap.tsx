/**
 * The run-page identity banner — the top block on every live/finished run
 * screen (generic runner + council). Brings the fresh-run hero's warmth onto
 * the run page for continuity: the agent's icon tile, title and tagline, a live
 * status pill (pulsing "Running" / "Loading" → calm green "Completed"), and the
 * submitted inputs as soft chips, gently faded in on mount.
 *
 * It's a *recap*, not a form: none of the non-chat graphs support real mid-run
 * follow-up (only stock_evaluation's chat graph has interrupt/resume), so the
 * inputs are read-only and "Start a new run" begins a genuinely fresh run
 * instead of pretending to amend in place.
 */
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Button, Card, Text } from '@/components/ui';
import type { AgentDef } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

type RunState = 'running' | 'loading' | 'error' | 'done';

export function RunRecap({
  agent,
  values,
  busy,
  loading,
  failed,
  onStop,
}: {
  agent: AgentDef;
  values: Record<string, string>;
  busy: boolean;
  /** Thread-state fetch in flight (reopen hydration) — shown as "Loading". */
  loading?: boolean;
  /**
   * The run ended in an error (`stream.error`). Without this a failed run drew
   * the green "Completed" pill directly above its own error card. Previously
   * unreachable — an errored run fell back to the landing hero before anyone
   * could see the contradiction (see `showsLandingHero`).
   */
  failed?: boolean;
  onStop?: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const filled = agent.inputs.filter((f) => values[f.key]?.trim());
  // Order matters: a resumed/retried run is "running" again even if the last
  // attempt failed, and hydration outranks a stale error from the prior mount.
  const state: RunState = busy ? 'running' : loading ? 'loading' : failed ? 'error' : 'done';
  // `push` (not `setParams`/`replace`) reliably mounts a NEW screen instance —
  // the same idiom the Calls tab's `openThread` uses — so the pinned `threadId`
  // prop and `useRunStream`'s internal state actually reset for a fresh run.
  const onNewRun = () =>
    router.push({ pathname: '/agents/[assistantId]', params: { assistantId: agent.id } });

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(350)}>
      <Card tone="sticker" className="gap-3">
        {/* Identity: icon tile · title + tagline · status pill. */}
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-bun border-2 border-frosting-200 bg-frosting-100 dark:border-night-border dark:bg-night-surface-muted">
            <Icon name={agent.icon} size={26} color={palette.frosting[600]} />
          </View>
          <View className="flex-1">
            <Text variant="heading" numberOfLines={1}>
              {agent.title}
            </Text>
            <Text variant="muted" numberOfLines={2}>
              {agent.tagline}
            </Text>
          </View>
          <StatusPill state={state} reduceMotion={reduceMotion} />
        </View>

        {/* Submitted inputs as soft chips (empty during reopen hydration). */}
        {filled.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {filled.map((f) => (
              <InputChip key={f.key} label={f.label} value={values[f.key]} />
            ))}
          </View>
        ) : null}

        <View className="flex-row gap-2">
          {state === 'running' && onStop ? (
            <Button title="Stop" variant="ghost" size="sm" onPress={onStop} />
          ) : null}
          <Button title="Start a new run" variant="secondary" size="sm" onPress={onNewRun} />
        </View>
      </Card>
    </Animated.View>
  );
}

/** A labelled tag for one submitted input — soft rectangle handles short
 *  tickers and long research queries alike (a pill would clip long text). */
function InputChip({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5 rounded-crumb border border-frosting-200 bg-white/70 px-3 py-1.5 dark:border-night-border dark:bg-night-surface">
      <Text variant="label">{label}</Text>
      <Text variant="body" className="text-sm">
        {value}
      </Text>
    </View>
  );
}

/** Running/Loading (butter, pulsing dot) → Completed (leaf-green check). */
function StatusPill({ state, reduceMotion }: { state: RunState; reduceMotion: boolean }) {
  if (state === 'done') {
    return (
      <View className="flex-row items-center gap-1.5 rounded-pill border border-leaf-500/40 bg-leaf-500/15 px-2.5 py-1">
        <Icon name="check-circle" size={14} color={palette.leaf[600]} weight="fill" />
        <Text className="font-heading text-xs text-leaf-600">Completed</Text>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <View className="flex-row items-center gap-1.5 rounded-pill border border-bearish/30 bg-bearish/15 px-2.5 py-1">
        <Icon name="warning" size={14} color={palette.bearish} weight="fill" />
        <Text className="font-heading text-xs text-bearish">Failed</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1.5 rounded-pill border border-butter-500/40 bg-butter-500/15 px-2.5 py-1">
      <PulseDot reduceMotion={reduceMotion} />
      <Text className="font-heading text-xs text-butter-600">
        {state === 'running' ? 'Running' : 'Loading'}
      </Text>
    </View>
  );
}

/** Soft pulsing dot — the banner always feels alive while work is in flight. */
function PulseDot({ reduceMotion }: { reduceMotion: boolean }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(0.35, { duration: 700 }), -1, true);
  }, [pulse, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={style} className="h-2 w-2 rounded-pill bg-butter-500" />;
}
