import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Screen, Text } from '@/components/ui';
import {
  agentTitleForThread,
  relativeTime,
  threadStatusTone,
} from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { Conversation, SubagentActivity, type SubagentRun, type SubagentRuns } from '@/features/agent-chat/conversation';
import { CriterionDetails, isMessageArray, StructuredOutput, type Criterion, type Todo } from '@/lib/agent/renderers';

/**
 * Historical sub-agent rows straight from the thread's persisted values —
 * captured deep-agent transcripts plus one row per criterion evaluation.
 * Completed runs have no replayable event stream, so checkpointed state is
 * the only (and cheap: one `threads.get`) source here.
 */
function historicalRuns(values: Record<string, unknown> | undefined): SubagentRun[] {
  const captured = values?.subagent_runs as SubagentRuns | undefined;
  const evals = Array.isArray(values?.criterion_evaluations)
    ? (values.criterion_evaluations as Criterion[])
    : [];
  return [
    ...(captured ? Object.values(captured) : []),
    ...evals.map((c) => ({
      name: c.criterion_name ? `Criterion — ${c.criterion_name}` : 'Criterion',
      status: 'complete' as const,
      renderDetail: () => <CriterionDetails c={c} />,
    })),
  ];
}

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
            const values = thread.values as
              | ({ messages?: unknown; todos?: Todo[]; subagent_runs?: SubagentRuns } & Record<string, unknown>)
              | undefined;
            const activity = historicalRuns(values);
            if (values && isMessageArray(values.messages)) {
              return (
                <Conversation
                  messages={values.messages}
                  todos={values.todos}
                  viewMode="summary"
                  subagentRuns={values.subagent_runs}
                />
              );
            }
            if (values && Object.keys(values).length > 0) {
              return (
                <>
                  <Card tone="raised" className="gap-2">
                    <Text variant="label">Result</Text>
                    <StructuredOutput value={values} />
                  </Card>
                  <SubagentActivity runs={activity} />
                </>
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
