/**
 * The runner's output half: run progress, the headline result (tailored
 * renderer per registry `resultRenderer`), the tool-execution summary, and the
 * sub-agents panel — plus the hydration skeleton that holds this layout's
 * shape while a reopened thread loads.
 */
import type { SubgraphDiscoverySnapshot } from '@langchain/langgraph-sdk/stream';
import { View } from 'react-native';

import { Badge, Card, Skeleton, Text } from '@/components/ui';
import { Conversation, type SubagentRun } from '@/features/agent-shared/conversation';
import { RunProgress } from '@/features/agent-shared/run-progress';
import { HydrationCard } from '@/features/agent-shared/run-surface';
import { SubagentActivity } from '@/features/agent-shared/subagent-activity';
import type { AgentDef } from '@/lib/agent/registry';
import {
  collectToolRuns,
  CriteriaResult,
  ResearchResult,
  StructuredOutput,
  ToolRunsSummary,
  TradingResult,
  type Todo,
} from '@/lib/agent/renderers';

const renderRunTranscript = (run: SubagentRun) => (
  <Conversation messages={run.messages ?? []} viewMode="verbose" />
);

const RESULT_RENDERERS: Record<string, (value: unknown, runs?: SubagentRun[]) => React.ReactNode> = {
  research: (value) => <ResearchResult value={value} />,
  criteria: (value, runs) => (
    <CriteriaResult value={value} subagentRuns={runs} renderTranscript={renderRunTranscript} />
  ),
  trading: (value) => <TradingResult value={value} />,
};

/**
 * Placeholder panels shown while a reopened thread hydrates (`isThreadLoading`
 * — one `getState` that can take a while on the deployed backend). The run
 * plan is predetermined by the registry, so its skeleton shows the real stage
 * labels; the result and sub-agent panels keep their shape as pulsing blocks.
 */
export function HydrationSkeleton({ agent }: { agent: AgentDef }) {
  return (
    <View className="gap-4">
      <HydrationCard label="Loading this run…">
        {agent.stages?.length ? (
          <View className="gap-1.5">
            {agent.stages.map((s) => (
              <View key={s.key} className="flex-row items-center gap-2.5">
                <View className="w-5 items-center">
                  <Skeleton className="h-3.5 w-3.5 rounded-pill" />
                </View>
                <Text variant="body" className="flex-1 text-sm text-ink-soft dark:text-night-text-muted">
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </HydrationCard>
      {/* Headline result placeholder. */}
      <Card className="gap-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </Card>
      {/* Tool execution + sub-agents placeholder. */}
      <Card tone="muted" className="gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-1/2" />
      </Card>
    </View>
  );
}

export function RunResults({
  agent,
  view,
  result,
  hasResult,
  busy,
  byNode,
  subagentRuns,
}: {
  agent: AgentDef;
  /** The merged values view (root state ∪ live criterion events). */
  view: Record<string, unknown>;
  result: unknown;
  hasResult: boolean;
  busy: boolean;
  byNode: ReadonlyMap<string, readonly SubgraphDiscoverySnapshot[]>;
  subagentRuns: SubagentRun[];
}) {
  return (
    <>
      {/* Done / doing / next — driven by subgraph discovery while it streams. */}
      <RunProgress
        agent={agent}
        values={view}
        todos={(view as { todos?: Todo[] } | undefined)?.todos}
        busy={busy}
        byNode={byNode}
      />

      {/* Headline result — same widget live and from history. */}
      {hasResult ? (
        agent.resultRenderer && RESULT_RENDERERS[agent.resultRenderer] ? (
          RESULT_RENDERERS[agent.resultRenderer](result, subagentRuns)
        ) : (
          <Card className="gap-2">
            <Badge label={busy ? 'streaming result' : 'result'} tone="info" />
            <StructuredOutput value={result} />
          </Card>
        )
      ) : null}

      {/* Run-level tool execution: per-tool success/fail/cached counts, drill
          down to each call's inputs/outputs/errors. Rows join the provider-call
          cache (RunSurface's ToolCacheProvider) to show the full gathered
          payload + size + timestamp on expand. Grows live for criteria — the
          merged view's evaluations carry each worker's tool_runs. */}
      <ToolRunsSummary
        runs={collectToolRuns(view)}
        emptyMessage={
          !busy
            ? 'No tool telemetry was recorded for this run — older runs predate capture; re-run the agent to capture per-tool calls here.'
            : undefined
        }
      />

      {/* Sub-agent activity (deep agents like criteria) — captured transcripts. */}
      <SubagentActivity runs={subagentRuns} />
    </>
  );
}
