import { toMessageDict } from '@langchain/langgraph-sdk/ui';
import { useMessages } from '@langchain/react';
import { View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Card, ProgressBar, Skeleton, Text } from '@/components/ui';
import {
  DebateTurns,
  bullBearTurns,
  debatersForTurns,
  namedMessageTurns,
} from '@/features/multi-agent/debate';
import {
  CriterionDetails,
  StructuredOutput,
  ToolRunsPanel,
  type AnyMessage,
} from '@/lib/agent/renderers';
import { useRunStreamContext } from '@/lib/agent/stream-context';
import { Conversation } from './conversation';
import type { SubgraphRow } from './run-projections';
import { useEstimatedProgress } from './use-estimated-progress';

/**
 * Shape a stage's `detail: 'debate'` output into debate turn bubbles. This is
 * always reached from an already-expanded `SubAgentRunRow`, so it renders the
 * bare `DebateTurns` — not a second nested collapsible.
 */
function DebateDetail({ output }: { output: unknown }) {
  const turns = Array.isArray(output)
    ? namedMessageTurns(output)
    : bullBearTurns(
        (output as { bull?: unknown } | null)?.bull,
        (output as { bear?: unknown } | null)?.bear,
      );
  return <DebateTurns debaters={debatersForTurns(turns)} turns={turns} />;
}

/** Placeholder for a subagent whose detail hasn't streamed in yet — a loading
 * bar (so it's clear more is still coming) over a skeleton shaped like the
 * transcript that will replace it (an input block + a Steps timeline of rail-dot
 * rows), so the layout doesn't jump when the real content lands. */
function SubgraphDetailSkeleton() {
  const reduceMotion = useReducedMotion();
  const { value, remainingLabel } = useEstimatedProgress({ estimateMs: 30_000 });
  return (
    <View className="gap-3">
      {/* Loading bar — this specialist's detail is still streaming in. */}
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text variant="muted" className="flex-1 text-xs">Loading detail…</Text>
          <Text variant="muted" className="text-xs">{remainingLabel}</Text>
        </View>
        <ProgressBar value={value} animate={!reduceMotion} accessibilityLabel="Loading sub-agent detail" />
      </View>
      {/* input / task block */}
      <View className="gap-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </View>
      {/* Steps timeline card */}
      <Card tone="muted" className="gap-2">
        <View className="flex-row items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-crumb" />
          <Skeleton className="h-3.5 w-16" />
        </View>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="flex-row items-center gap-3">
            <Skeleton className="h-6 w-6 rounded-pill" />
            <Skeleton className="h-3.5 flex-1" />
          </View>
        ))}
      </Card>
    </View>
  );
}

/**
 * Expanded content of one discovered subgraph invocation (criteria worker /
 * stage agent / trading analyst).
 *
 * Live runs: the scoped transcript + tool calls streamed under the node's
 * namespace (scoped selectors read from the shared channel registry, so
 * mounting this lazily — on expand — opens no extra connections).
 *
 * Completed threads: the event stream is gone (transient buffer, never
 * replayable), so the scoped channels stay empty. The row falls back to what
 * checkpointed state DID keep: the criterion evaluation (workers), the stage's
 * structured output (registry `StageDef.output`), and the run-level `tool_runs`
 * records the backend attributed to this node.
 */
export function SubgraphDetail({ row }: { row: SubgraphRow }) {
  const stream = useRunStreamContext();
  const scopedMessages = useMessages(stream, row.namespace);

  const messages = scopedMessages.map((m) => toMessageDict(m)) as AnyMessage[];
  const output = row.evaluation == null && messages.length === 0 ? row.output : undefined;
  // Historical fall-back only: the persisted `tool_runs` records (authoritative
  // status). While live, the scoped `Conversation` (Steps) below already shows
  // every tool call WITH its correct `ToolMessage.status`, so a separate flat
  // panel would be redundant AND carried the wrong (lifecycle-derived) status.
  const persistedRuns = row.toolRuns ?? [];
  const hasBody = !!row.evaluation || output != null || messages.length > 0 || persistedRuns.length > 0;

  if (!hasBody) {
    if (row.status !== 'error' && stream.isLoading) {
      return <SubgraphDetailSkeleton />;
    }
    return (
      <Text variant="muted" className="text-xs">
        {row.status === 'running' ? 'Working — details will appear as this specialist reports back.' : 'No detail was recorded for this step.'}
      </Text>
    );
  }

  return (
    <View className="gap-3">
      {row.evaluation ? <CriterionDetails c={row.evaluation} /> : null}
      {output != null ? (
        row.detail === 'debate' ? (
          <View className="gap-1">
            <Text variant="label">Debate</Text>
            <DebateDetail output={output} />
          </View>
        ) : (
          <View className="gap-1">
            <Text variant="label">Result</Text>
            <StructuredOutput value={output} />
          </View>
        )
      ) : null}
      {messages.length > 0 ? (
        /* Live transcript — the Steps timeline includes every tool call. The
           `busy` footer keeps it clear more is still streaming in. */
        <Conversation messages={messages} viewMode="verbose" busy={row.status === 'running'} />
      ) : (
        /* History (no replayable transcript) — persisted tool records only. */
        <ToolRunsPanel title="Tool calls" runs={persistedRuns} mode="flat" />
      )}
    </View>
  );
}
