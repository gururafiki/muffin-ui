import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Screen, Text } from '@/components/ui';
import {
  agentTitleForThread,
  relativeTime,
  threadStatusTone,
} from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { Conversation } from '@/features/agent-chat/conversation';
import { isMessageArray, StructuredOutput } from '@/lib/agent/renderers';
import type { Todo } from '@/lib/agent/renderers';

export default function CallDetailRoute() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { data: thread, isLoading, isError, error } = useCall(threadId);

  const title = thread ? agentTitleForThread(thread) : 'Call';

  return (
    <Screen>
      <Stack.Screen options={{ title }} />

      {isLoading ? (
        <Card tone="muted" className="mt-4">
          <Text variant="muted">Loading call…</Text>
        </Card>
      ) : isError || !thread ? (
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Couldn’t load this call</Text>
          <Text variant="muted">
            {error instanceof Error ? error.message : 'The thread may no longer exist.'}
          </Text>
        </Card>
      ) : (
        <View className="mt-4 gap-4">
          <Card tone="sticker" className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text variant="heading">{agentTitleForThread(thread)}</Text>
              <Badge label={thread.status} tone={threadStatusTone(thread.status)} />
            </View>
            <Text variant="muted">{relativeTime(thread.created_at)}</Text>
            <Text variant="mono" className="text-xs">
              {thread.thread_id}
            </Text>
          </Card>

          {(() => {
            const values = thread.values as { messages?: unknown; todos?: Todo[] } | undefined;
            if (values && isMessageArray(values.messages)) {
              return <Conversation messages={values.messages} todos={values.todos} viewMode="summary" />;
            }
            if (values && Object.keys(values).length > 0) {
              return (
                <Card tone="raised" className="gap-2">
                  <Text variant="label">Result</Text>
                  <StructuredOutput value={values} />
                </Card>
              );
            }
            return (
              <Card tone="muted">
                <Text variant="muted">This call has no stored result.</Text>
              </Card>
            );
          })()}
        </View>
      )}
    </Screen>
  );
}
