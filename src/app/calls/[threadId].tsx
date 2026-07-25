import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Screen, Skeleton, Text } from '@/components/ui';
import {
  agentTitleForThread,
  relativeTime,
  threadStatusTone,
} from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { Conversation, type SubagentRun, type SubagentRuns } from '@/features/agent-shared/conversation';
import { SubagentActivity } from '@/features/agent-shared/subagent-activity';
import { SubagentTree } from '@/features/agent-shared/subagent-tree';
import { collectToolRuns, CriterionDetails, isMessageArray, StructuredOutput, ToolRunsPanel, type Todo } from '@/lib/agent/renderers';
import { parseArray, zCriterionEvaluation } from '@/lib/agent/schemas';
import { buildForest, collectSubagentTree, type TreeRow } from '@/lib/agent/subagent-tree';
import { ToolCacheProvider } from '@/lib/agent/tool-cache';

/**
 * Historical sub-agent rows straight from the thread's persisted values —
 * captured deep-agent transcripts plus one row per criterion evaluation.
 * Completed runs have no replayable event stream, so checkpointed state is
 * the only (and cheap: one `threads.get`) source here. `renderTree` (built by
 * the caller, which owns `threadId`) lets each criterion's own detail show
 * its recursive sub-agent forest, if it captured one.
 */
function historicalRuns(
  values: Record<string, unknown> | undefined,
  renderTree: (rows: TreeRow[]) => React.ReactNode,
): SubagentRun[] {
  const captured = values?.subagent_runs as SubagentRuns | undefined;
  const evals = parseArray(zCriterionEvaluation, values?.criterion_evaluations, 'criterion_evaluations');
  return [
    ...(captured ? Object.values(captured) : []),
    ...evals.map((c) => ({
      name: c.criterion_name ? `Criterion — ${c.criterion_name}` : 'Criterion',
      status: 'complete' as const,
      renderDetail: () => <CriterionDetails c={c} renderTree={renderTree} />,
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

          {(() => {
            const values = thread.values as
              | ({ messages?: unknown; todos?: Todo[]; subagent_runs?: SubagentRuns } & Record<string, unknown>)
              | undefined;
            // Recursive sub-agent tree, straight from persisted state (the
            // AUGMENT — rendered instead of the flat panel when non-empty;
            // older threads with no captured tree keep the flat panel).
            const renderTree = (rows: TreeRow[]) => <SubagentTree rows={rows} threadId={threadId} />;
            const tree = buildForest(collectSubagentTree(values));
            const activity = historicalRuns(values, renderTree);
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
                  {tree.length > 0 ? (
                    <SubagentTree rows={tree} threadId={threadId} />
                  ) : (
                    <SubagentActivity runs={activity} />
                  )}
                </>
              );
            }
            return (
              <Card tone="muted">
                <Text variant="muted">This call has no stored result.</Text>
              </Card>
            );
          })()}

          {/* Tool execution from persisted state — rows join the provider-call
              cache on expand for the full gathered payload. */}
          <ToolRunsPanel title="Tool execution" mode="grouped" runs={collectToolRuns(thread.values)} />
        </View>
        </ToolCacheProvider>
      )}
    </Screen>
  );
}
