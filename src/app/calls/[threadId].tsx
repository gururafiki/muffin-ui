import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Screen, Skeleton, Text } from '@/components/ui';
import {
  agentTitleForThread,
  relativeTime,
  threadGraphId,
  threadStatusTone,
} from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { useAgentView } from '@/features/agent-shared/agent-view-store';
import { Conversation, type SubagentRun } from '@/features/agent-shared/conversation';
import { ExecutionTree } from '@/features/agent-shared/execution-tree/execution-tree';
import { RunViewToggle } from '@/features/agent-shared/run-view-toggle';
import { SubagentActivity } from '@/features/agent-shared/subagent-activity';
import { getAgent } from '@/lib/agent/registry';
import { CriterionDetails, isMessageArray, StructuredOutput, type Todo } from '@/lib/agent/renderers';
import { parseArray, zCriterionEvaluation } from '@/lib/agent/schemas';
import { ToolCacheProvider } from '@/lib/agent/tool-cache';

/**
 * The result rows for a finished run: one per criterion evaluation, straight from
 * the thread's persisted values (one cheap `threads.get`).
 *
 * These are *results*, not execution. What each worker did to reach its verdict —
 * transcript, tool calls, sub-agents — is in the Execution Tree, which reads that
 * worker's own LangGraph namespace on demand.
 */
function historicalRuns(values: Record<string, unknown> | undefined): SubagentRun[] {
  const evals = parseArray(zCriterionEvaluation, values?.criterion_evaluations, 'criterion_evaluations');
  return evals.map((c) => ({
    name: c.criterion_name ? `Criterion — ${c.criterion_name}` : 'Criterion',
    status: 'complete' as const,
    renderDetail: () => <CriterionDetails c={c} />,
  }));
}

export default function CallDetailRoute() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { data: thread, isLoading, isError, error } = useCall(threadId);

  // Resolve the run's registry agent (from the server-owned graph_id) so this
  // history view can offer the same Overview ↔ Execution-tree toggle the live
  // surfaces do. Unknown graph → no agent → toggle hidden, Overview only.
  const agentId = thread ? threadGraphId(thread) : undefined;
  const agent = agentId ? getAgent(agentId) : undefined;
  const agentView = useAgentView(agentId ?? '');

  const title = thread ? agentTitleForThread(thread) : 'Call';

  return (
    <Screen>
      <Stack.Screen options={{ title }} />

      {isLoading ? (
        /* Skeleton mirroring the loaded layout: header card, result, panels. */
        <View className="mt-4 gap-4">
          <Card tone="sticker" className="gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-64" />
          </Card>
          <Card tone="raised" className="gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </Card>
          <Card tone="muted" className="gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-1/2" />
          </Card>
        </View>
      ) : isError || !thread ? (
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Couldn’t load this call</Text>
          <Text variant="muted">
            {error instanceof Error ? error.message : 'The thread may no longer exist.'}
          </Text>
        </Card>
      ) : (
        <ToolCacheProvider thread={threadId} busy={false}>
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

          {agent ? <RunViewToggle agentId={agent.id} /> : null}

          {agentView === 'tree' && agent ? (
            <ExecutionTree
              agent={agent}
              values={(thread.values ?? {}) as Record<string, unknown>}
              busy={false}
              threadId={threadId}
            />
          ) : (
          <>
          {(() => {
            const values = thread.values as
              | ({ messages?: unknown; todos?: Todo[] } & Record<string, unknown>)
              | undefined;
            if (values && isMessageArray(values.messages)) {
              return <Conversation messages={values.messages} todos={values.todos} viewMode="summary" />;
            }
            if (values && Object.keys(values).length > 0) {
              return (
                <>
                  <Card tone="raised" className="gap-2">
                    <Text variant="label">Result</Text>
                    <StructuredOutput value={values} />
                  </Card>
                  <SubagentActivity runs={historicalRuns(values)} />
                </>
              );
            }
            return (
              <Card tone="muted">
                <Text variant="muted">This call has no stored result.</Text>
              </Card>
            );
          })()}
          </>
          )}
        </View>
        </ToolCacheProvider>
      )}
    </Screen>
  );
}
