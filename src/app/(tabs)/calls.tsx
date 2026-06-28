import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Screen, Text } from '@/components/ui';
import {
  agentTitleForThread,
  relativeTime,
  threadStatusTone,
} from '@/features/agent-calls/threads';
import { useCalls } from '@/features/agent-calls/use-calls';
import { palette } from '@/theme/colors';

export default function CallsScreen() {
  const router = useRouter();
  const { data: threads, isLoading, isError, error } = useCalls();

  return (
    <Screen plaid>
      <Text variant="title" className="pt-4">
        Calls
      </Text>
      <Text variant="muted">Past agent runs. Tap one to revisit its result.</Text>

      <View className="mt-4 gap-3">
        {isLoading ? (
          <Card tone="muted">
            <Text variant="muted">Loading past calls…</Text>
          </Card>
        ) : isError ? (
          <Card tone="outline">
            <Text variant="heading">Couldn’t load calls</Text>
            <Text variant="muted">
              {error instanceof Error ? error.message : 'Check the API URL and key in Settings.'}
            </Text>
          </Card>
        ) : !threads || threads.length === 0 ? (
          <Card tone="muted">
            <Text variant="heading">No past calls yet</Text>
            <Text variant="muted">Run an agent and it’ll show up here.</Text>
          </Card>
        ) : (
          threads.map((thread) => (
            <Pressable
              key={thread.thread_id}
              onPress={() => router.push(`/calls/${thread.thread_id}`)}
              className="active:opacity-80">
              <Card tone="sticker" className="flex-row items-center gap-3">
                <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
                  <Icon name="history" size={26} color={palette.frosting[600]} />
                </View>
                <View className="flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <Text variant="heading">{agentTitleForThread(thread)}</Text>
                    <Badge label={thread.status} tone={threadStatusTone(thread.status)} />
                  </View>
                  <Text variant="muted">{relativeTime(thread.created_at)}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={palette.frosting[300]} weight="bold" />
              </Card>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  );
}
