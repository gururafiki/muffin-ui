/**
 * Single-shot agent run screen (research / criteria / trading). Thread-scoped
 * via `useRunStream` (protocol v2): hitting Run creates a thread and pushes its
 * id into the URL, a refresh rejoins the thread's event stream, and reopening
 * from Calls hydrates the SAME projections from state — the result widget
 * renders identically live and from history.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AdvancedOptions } from '@/components/advanced-options';
import { Button, Field, Screen } from '@/components/ui';
import { useSignInRequiredToRun } from '@/features/account/run-gate';
import { useAgentView } from '@/features/agent-shared/agent-view-store';
import { AgentHero } from '@/features/agent-shared/agent-hero';
import { type SubagentRun } from '@/features/agent-shared/conversation';
import { ExecutionTree } from '@/features/agent-shared/execution-tree/execution-tree';
import { mergeLiveEvaluations, useCriterionEvents, useSubgraphRows } from '@/features/agent-shared/run-projections';
import { RunRecap } from '@/features/agent-shared/run-recap';
import { RunErrorCard, RunSurface } from '@/features/agent-shared/run-surface';
import { RunViewToggle } from '@/features/agent-shared/run-view-toggle';
import { SubgraphDetail } from '@/features/agent-shared/subgraph-detail';
import { useRunStream } from '@/features/agent-shared/use-run-stream';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { HydrationSkeleton, RunResults } from './run-results';
import { SavePresetCard } from './save-preset-card';

function isNonEmpty(v: unknown): boolean {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

export function AgentRunner({
  agent,
  initialValues,
  autoStart,
  threadId,
  assistantId,
}: {
  agent: AgentDef;
  initialValues?: Record<string, string>;
  autoStart?: boolean;
  /** Reopen a past run (from the Calls tab / a refresh). */
  threadId?: string;
  /** Run a saved preset assistant instead of the bare graph. */
  assistantId?: string;
}) {
  // `threadId` (the prop) is pinned at screen mount — undefined for a fresh run.
  // `liveThreadId` follows the run: useRunStream updates it via onThreadId when
  // a new thread is created, so per-thread data hooks below follow the live run.
  const { stream, submitRun, threadId: liveThreadId } = useRunStream(agent, { assistantId, threadId });
  // Pre-submit draft only — never merged with the reopened run's saved inputs.
  // A reopened/finished run shows those via the read-only `RunRecap` instead.
  const [draft, setDraft] = useState<Record<string, string>>(initialValues ?? {});
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));

  const busy = stream.isLoading;
  // Overview (bespoke result widget) vs the generic Execution-tree view —
  // per-agent, persisted on-device; default Overview.
  const agentView = useAgentView(agent.id);
  // The values view: root state unioned with live `criterion_evaluated` custom
  // events, so criteria rows/counters stream in ahead of the superstep barrier.
  const { byName } = useCriterionEvents(stream);
  const view = useMemo(() => mergeLiveEvaluations(stream.values, byName), [stream.values, byName]);
  const result = agent.resultKey ? view?.[agent.resultKey] : view;
  const hasResult = isNonEmpty(result);

  // The reopened/submitted run's actual inputs, straight from streamed state —
  // shown read-only via `RunRecap`, never merged with the pre-submit draft.
  const savedInputs = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of agent.inputs) if (typeof view?.[f.key] === 'string') out[f.key] = view[f.key] as string;
    return out;
  }, [view, agent.inputs]);

  const signInRequired = useSignInRequiredToRun();
  const canRun = useMemo(
    () => agent.inputs.every((f) => !f.required || (draft[f.key]?.trim()?.length ?? 0) > 0),
    [agent.inputs, draft],
  );

  // Sub-agent rows: the subgraph invocations discovered on the live stream
  // (criteria stages/workers, trading analysts) with their statuses and scoped
  // transcript detail. The recursive tree lives in the Execution Tree view,
  // which reads each node's own LangGraph namespace on expand.
  const discovered = useSubgraphRows(agent, stream);
  const subagentRuns: SubagentRun[] = discovered.map((row) => ({
    name: row.label,
    status: row.status,
    renderDetail: () => <SubgraphDetail row={row} />,
  }));

  const run = () => submitRun(agent.buildInput(draft), { overrides: buildOverrides(agent.advanced, advanced) });

  // Deep-link autostart ("Analyse" from a stock) — only for a fresh thread and
  // never when sign-in is required (the guard below prompts instead).
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !threadId && !started.current && canRun && !signInRequired) {
      started.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, canRun, threadId, signInRequired]);

  // Nothing to show yet but the landing hero: no thread pinned, not busy, no
  // result, and (for a reopened thread) not still hydrating.
  const isFreshRun = !threadId && !busy && !hasResult && !stream.isThreadLoading;

  if (isFreshRun) {
    return (
      <AgentHero
        agent={agent}
        signInRequired={signInRequired}
        examples={agent.exampleConfigs?.map((cfg) => ({
          label: cfg.label,
          onPress: () => setDraft(cfg.values),
        }))}>
        <View className="gap-3">
          {agent.inputs.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              autoCapitalize={f.autoCapitalize}
              autoCorrect={false}
              value={draft[f.key] ?? ''}
              onChangeText={(v) => setDraft((s) => ({ ...s, [f.key]: v }))}
            />
          ))}
          {agent.advanced?.length ? (
            <AdvancedOptions
              fields={agent.advanced}
              values={advanced}
              onChange={(k, v) => setAdvanced((s) => ({ ...s, [k]: v }))}
            />
          ) : null}
          <Button title="Run agent" disabled={!canRun} onPress={run} />
          <SavePresetCard agent={agent} advanced={advanced} />
        </View>
      </AgentHero>
    );
  }

  return (
    <Screen>
      <RunSurface stream={stream} threadId={liveThreadId}>
        <View className="gap-4">
          <RunRecap
            agent={agent}
            values={savedInputs}
            busy={busy}
            loading={stream.isThreadLoading}
            onStop={() => stream.stop()}
          />

          <RunViewToggle agentId={agent.id} />

          <RunErrorCard error={stream.error} />

          {stream.isThreadLoading ? (
            /* Reopened thread, state fetch in flight — hold the layout's shape. */
            <HydrationSkeleton agent={agent} />
          ) : agentView === 'tree' ? (
            <ExecutionTree
              agent={agent}
              values={view}
              busy={busy}
              byNode={stream.subgraphsByNode}
              threadId={liveThreadId}
            />
          ) : (
            <RunResults
              agent={agent}
              view={view}
              result={result}
              hasResult={hasResult}
              busy={busy}
              byNode={stream.subgraphsByNode}
              subagentRuns={subagentRuns}
              threadId={liveThreadId}
            />
          )}
        </View>
      </RunSurface>
    </Screen>
  );
}
