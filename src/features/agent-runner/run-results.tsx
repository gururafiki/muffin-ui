/**
 * The runner's output half: run progress, the headline result (tailored
 * renderer per registry `resultRenderer`), the tool-execution summary, and the
 * sub-agents panel — plus the hydration skeleton that holds this layout's
 * shape while a reopened thread loads.
 */
import type { SubgraphDiscoverySnapshot } from '@langchain/langgraph-sdk/stream';
import { View } from 'react-native';

import { Badge, Card, Skeleton, SkeletonText, Text } from '@/components/ui';
import { Conversation, type SubagentRun } from '@/features/agent-shared/conversation';
import { RunProgress } from '@/features/agent-shared/run-progress';
import { HydrationCard } from '@/features/agent-shared/run-surface';
import { SubagentActivity, SubagentPanelSkeleton } from '@/features/agent-shared/subagent-activity';
import type { AgentDef } from '@/lib/agent/registry';
import {
  CriteriaResult,
  ResearchResult,
  StructuredOutput,
  TradingResult,
  type Todo,
} from '@/lib/agent/renderers';

const renderRunTranscript = (run: SubagentRun) => (
  <Conversation messages={run.messages ?? []} viewMode="verbose" />
);

const RESULT_RENDERERS: Record<
  string,
  (value: unknown, runs?: SubagentRun[], threadId?: string) => React.ReactNode
> = {
  research: (value) => <ResearchResult value={value} />,
  criteria: (value, runs) => (
    <CriteriaResult value={value} subagentRuns={runs} renderTranscript={renderRunTranscript} />
  ),
  trading: (value) => <TradingResult value={value} />,
};

/**
 * Result renderers that open with a signal pill + confidence bar. Keyed on the registry's
 * own `resultRenderer` vocabulary — the same field `RESULT_RENDERERS` above dispatches on —
 * so this stays in step with what actually renders rather than being a second agent list.
 */
const VERDICT_RESULTS = new Set(['criteria', 'trading']);

/**
 * Placeholder panels shown while a reopened thread hydrates (`isThreadLoading`
 * — one `getState` that can take a while on the deployed backend). Shaped to
 * match the real result layout so nothing jumps when data lands: the run-plan
 * checklist (real stage labels + an indeterminate loading bar), a headline
 * verdict card, a few report-section rows, and the sub-agents panel.
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

      {/* Headline card — verdict-shaped ONLY for agents whose result is a verdict.
          `criteria` and `trading` open with a signal pill + confidence bar; `research`
          returns prose and every other agent falls through to `StructuredOutput`, so
          promising a pill there advertises a shape that never arrives. */}
      <Card tone="sticker" className="gap-3">
        {VERDICT_RESULTS.has(agent.resultRenderer ?? '') ? (
          <View className="flex-row items-center gap-3">
            <Skeleton className="h-10 w-24 rounded-pill" />
            <View className="flex-1 gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2 w-full rounded-pill" />
            </View>
          </View>
        ) : null}
        <SkeletonText lines={3} />
      </Card>

      {/* Report-section rows (icon · label · chevron). */}
      {[0, 1, 2].map((i) => (
        <Card key={i} tone="muted" className="flex-row items-center gap-2.5">
          <Skeleton className="h-4 w-4 rounded-crumb" />
          <Skeleton className="h-3.5 w-40" />
          <View className="flex-1" />
          <Skeleton className="h-3.5 w-3.5" />
        </Card>
      ))}

      {/* Sub-agents panel — same skeleton the discovery gap uses. */}
      <SubagentPanelSkeleton />
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
  threadId,
}: {
  agent: AgentDef;
  /** The merged values view (root state ∪ live criterion events). */
  view: Record<string, unknown>;
  result: unknown;
  hasResult: boolean;
  busy: boolean;
  byNode: ReadonlyMap<string, readonly SubgraphDiscoverySnapshot[]>;
  subagentRuns: SubagentRun[];
  threadId?: string;
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
          RESULT_RENDERERS[agent.resultRenderer](result, subagentRuns, threadId)
        ) : (
          <Card className="gap-2">
            <Badge label={busy ? 'streaming result' : 'result'} tone="info" />
            <StructuredOutput value={result} />
          </Card>
        )
      ) : null}

      {/* Sub-agent activity as the live stream discovers it. Tool calls are NOT
          rolled up here any more: they belong to the node that made them, and
          that attribution lives in the Timeline view, which reads each node's
          own LangGraph namespace on expand. A run-wide roll-up would have to
          walk every namespace eagerly to rebuild what the capture channel used
          to flatten for it.
          `loadingHint` holds a panel skeleton through the discovery `/history`
          gap for agents that surface native subagents (node-based stages). */}
      <SubagentActivity runs={subagentRuns} loadingHint={agent.stages?.some((s) => !!s.node) ?? false} />
    </>
  );
}
