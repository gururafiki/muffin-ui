import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Screen, SkeletonRow, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { usePresets, useDeletePreset } from '@/features/presets/use-presets';
import { AGENTS, getAgent } from '@/lib/agent/registry';

export default function AgentsScreen() {
  const router = useRouter();
  const presets = usePresets();
  const deletePreset = useDeletePreset();

  return (
    <Screen plaid>
      <Text variant="title" className="pt-4">
        Agents
      </Text>
      <Text variant="muted">One graph, one page. Pick an agent to run.</Text>

      <View className="mt-4 gap-3">
        {AGENTS.map((agent) => (
          <Pressable
            key={agent.id}
            onPress={() => router.push(`/agents/${agent.id}`)}
            className="active:opacity-80">
            <Card tone="sticker" className="flex-row items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
                <Icon name={agent.icon} size={28} color={palette.frosting[600]} />
              </View>
              <View className="flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text variant="heading">{agent.title}</Text>
                  {agent.custom ? <Badge label="custom UI" tone="info" /> : null}
                </View>
                <Text variant="muted">{agent.tagline}</Text>
              </View>
              <Icon name="chevron-right" size={20} color={palette.frosting[300]} weight="bold" />
            </Card>
          </Pressable>
        ))}
      </View>

      {/* Presets come from the API, so reserve their shape rather than letting the whole
          section appear at once. `isPending` (not `!data`) — an empty result must render
          nothing, not skeletons forever. The static AGENTS list above is local and has
          always painted immediately. */}
      {presets.isPending ? (
        <View className="mt-6 gap-3">
          <Text variant="heading">Saved presets</Text>
          <Text variant="muted">Named configurations you saved. Tap to run.</Text>
          {[0, 1].map((i) => (
            <Card key={i}>
              <SkeletonRow tile="h-10 w-10" gap="gap-0.5" trailing="chevron" />
            </Card>
          ))}
        </View>
      ) : null}

      {presets.data?.length ? (
        <View className="mt-6 gap-3">
          <Text variant="heading">Saved presets</Text>
          <Text variant="muted">Named configurations you saved. Tap to run.</Text>
          {presets.data.map((p) => (
            <Pressable
              key={p.id}
              onPress={() =>
                router.push({
                  pathname: '/agents/[assistantId]',
                  params: { assistantId: p.graphId, preset: p.id },
                })
              }
              className="active:opacity-80">
              <Card className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
                  <Icon name="sparkle" size={22} color={palette.frosting[600]} />
                </View>
                <View className="flex-1 gap-0.5">
                  <Text variant="heading">{p.name}</Text>
                  <Text variant="muted">{getAgent(p.graphId)?.title ?? p.graphId}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete preset ${p.name}`}
                  onPress={() => deletePreset.mutate(p.id)}
                  hitSlop={8}
                  className="p-1 active:opacity-60">
                  <Icon name="close" size={18} color={palette.frosting[300]} />
                </Pressable>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
