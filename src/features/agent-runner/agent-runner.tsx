/**
 * Single-shot agent run screen (research / criteria / trading). Thread-scoped
 * via `useRunStream` (protocol v2): hitting Run creates a thread and pushes its
 * id into the URL, a refresh rejoins the thread's event stream, and reopening
 * from Calls hydrates the SAME projections from state — the result widget
 * renders identically live and from history.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { useSignInRequiredToRun } from '@/features/account/run-gate';
import { type SubagentRun, type SubagentRuns } from '@/features/agent-shared/conversation';
import { mergeLiveEvaluations, useCriterionEvents, useSubgraphRows } from '@/features/agent-shared/run-projections';
import { RunErrorCard, RunSurface } from '@/features/agent-shared/run-surface';
import { SubgraphDetail } from '@/features/agent-shared/subgraph-detail';
import { useRunStream } from '@/features/agent-shared/use-run-stream';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { RunInputForm } from './run-input-form';
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
  const [edits, setEdits] = useState<Record<string, string>>(initialValues ?? {});
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));

  const busy = stream.isLoading;
  // The values view: root state unioned with live `criterion_evaluated` custom
  // events, so criteria rows/counters stream in ahead of the superstep barrier.
  const { byName } = useCriterionEvents(stream);
  const view = useMemo(() => mergeLiveEvaluations(stream.values, byName), [stream.values, byName]);
  const result = agent.resultKey ? view?.[agent.resultKey] : view;
  const hasResult = isNonEmpty(result);

  // Effective form values: the reopened run's inputs (from streamed state),
  // overridden by anything the user types.
  const savedInputs = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of agent.inputs) if (typeof view?.[f.key] === 'string') out[f.key] = view[f.key] as string;
    return out;
  }, [view, agent.inputs]);
  const values = useMemo(() => ({ ...savedInputs, ...edits }), [savedInputs, edits]);

  const signInRequired = useSignInRequiredToRun();
  const canRun = useMemo(
    () => agent.inputs.every((f) => !f.required || (values[f.key]?.trim()?.length ?? 0) > 0),
    [agent.inputs, values],
  );

  // Sub-agent rows: captured deep-agent transcripts (persisted state channel)
  // + protocol-v2 discovered subgraph invocations (criteria stages/workers,
  // trading analysts) with live statuses and scoped transcript detail.
  const captured = (view as { subagent_runs?: SubagentRuns } | undefined)?.subagent_runs;
  const discovered = useSubgraphRows(agent, stream);
  const subagentRuns: SubagentRun[] = [
    ...(captured ? Object.values(captured) : []),
    ...discovered.map((row) => ({
      name: row.label,
      status: row.status,
      renderDetail: () => <SubgraphDetail row={row} />,
    })),
  ];

  const run = () => submitRun(agent.buildInput(values), { overrides: buildOverrides(agent.advanced, advanced) });

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

  return (
    <RunSurface stream={stream} threadId={liveThreadId}>
      <View className="gap-4">
        <RunInputForm
          agent={agent}
          values={values}
          onChangeField={(k, v) => setEdits((s) => ({ ...s, [k]: v }))}
          advanced={advanced}
          onChangeAdvanced={(k, v) => setAdvanced((s) => ({ ...s, [k]: v }))}
          hasResult={hasResult}
          busy={busy}
          hydrating={stream.isThreadLoading}
          signInRequired={signInRequired}
          canRun={canRun}
          onRun={run}
          onStop={() => stream.stop()}
        />

        <SavePresetCard agent={agent} advanced={advanced} />

        <RunErrorCard error={stream.error} />

        {stream.isThreadLoading ? (
          /* Reopened thread, state fetch in flight — hold the layout's shape. */
          <HydrationSkeleton agent={agent} />
        ) : (
          <RunResults
            agent={agent}
            view={view}
            result={result}
            hasResult={hasResult}
            busy={busy}
            byNode={stream.subgraphsByNode}
            subagentRuns={subagentRuns}
          />
        )}
      </View>
    </RunSurface>
  );
}
