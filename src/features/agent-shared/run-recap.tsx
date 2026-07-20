/**
 * Read-only recap of a run's submitted inputs — replaces the old always-
 * editable, pre-filled form once a thread has actually started/finished.
 * None of the non-chat graphs support real mid-run follow-up today (only
 * stock_evaluation's chat graph has interrupt/resume wiring), so "amend and
 * resubmit in place" is intentionally not offered here — "Start a new run"
 * starts a genuinely fresh run instead.
 */
import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import type { AgentDef } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

export function RunRecap({
  agent,
  values,
  busy,
  onStop,
}: {
  agent: AgentDef;
  values: Record<string, string>;
  busy: boolean;
  onStop?: () => void;
}) {
  const router = useRouter();
  const filled = agent.inputs.filter((f) => values[f.key]?.trim());
  // `push` (not `setParams`/`replace`) reliably mounts a NEW screen instance —
  // the same idiom the Calls tab's `openThread` uses — so the pinned `threadId`
  // prop and `useRunStream`'s internal state actually reset for a fresh run.
  const onNewRun = () =>
    router.push({ pathname: '/agents/[assistantId]', params: { assistantId: agent.id } });
  return (
    <Card tone="outline" className="gap-3">
      <View className="flex-row items-center gap-2">
        <Text variant="label" className="flex-1">{agent.title}</Text>
        {busy ? <ActivityIndicator size="small" color={palette.frosting[400]} /> : null}
      </View>
      {filled.length > 0 ? (
        <View className="gap-2">
          {filled.map((f) => (
            <View key={f.key} className="gap-0.5">
              <Text variant="muted" className="text-xs uppercase tracking-wide">{f.label}</Text>
              <Text variant="body">{values[f.key]}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View className="flex-row gap-2">
        {busy && onStop ? <Button title="Stop" variant="ghost" size="sm" onPress={onStop} /> : null}
        <Button title="Start a new run" variant="secondary" size="sm" onPress={onNewRun} />
      </View>
    </Card>
  );
}
