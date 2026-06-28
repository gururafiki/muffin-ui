import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Screen, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { AGENTS } from '@/lib/agent/registry';

export default function AgentsScreen() {
  const router = useRouter();

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
    </Screen>
  );
}
