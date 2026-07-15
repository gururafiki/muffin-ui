import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AdvancedOptions } from '@/components/advanced-options';
import { Badge, Button, Card, Collapsible, Field, Skeleton, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useCreatePreset } from '@/features/presets/use-presets';
import { SignInToRunNotice, useSignInRequiredToRun } from '@/features/account/run-gate';
import { Conversation, SubagentActivity, type SubagentRun, type SubagentRuns } from '@/features/agent-chat/conversation';
import { RunProgress } from '@/features/agent-chat/run-progress';
import { mergeLiveEvaluations, useCriterionEvents, useSubgraphRows } from '@/features/agent-chat/run-projections';
import { SubgraphDetail } from '@/features/agent-chat/subgraph-detail';
import { useRunStream } from '@/features/agent-chat/use-run-stream';
import type { AgentDef } from '@/lib/agent/registry';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import { collectToolRuns, CriteriaResult, ResearchResult, StructuredOutput, ToolRunsSummary, TradingResult, type Todo } from '@/lib/agent/renderers';
import { ToolCacheProvider } from '@/lib/agent/tool-cache';
import { buildPresetConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';

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

function isNonEmpty(v: unknown): boolean {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Placeholder panels shown while a reopened thread hydrates (`isThreadLoading`
 * — one `getState` that can take a while on the deployed backend). The run
 * plan is predetermined by the registry, so its skeleton shows the real stage
 * labels; the result and sub-agent panels keep their shape as pulsing blocks.
 */
function HydrationSkeleton({ agent }: { agent: AgentDef }) {
  return (
    <View className="gap-4">
      <Card tone="muted" className="gap-3">
        <View className="flex-row items-center gap-2.5">
          <ActivityIndicator size="small" color={palette.frosting[400]} />
          <Text variant="muted" className="flex-1 text-sm">Loading this run…</Text>
        </View>
        {agent.stages?.length ? (
          <View className="gap-1.5">
            {agent.stages.map((s) => (
              <View key={s.key} className="flex-row items-center gap-2.5">
                <View className="w-5 items-center">
                  <Skeleton className="h-3.5 w-3.5 rounded-pill" />
                </View>
                <Text variant="body" className="flex-1 text-sm text-[#9A8BB0] dark:text-night-text-muted">
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
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

/**
 * Single-shot agent run screen (research / criteria / trading). Thread-scoped
 * via `useRunStream` (protocol v2): hitting Run creates a thread and pushes its
 * id into the URL, a refresh rejoins the thread's event stream, and reopening
 * from Calls hydrates the SAME projections from state — the result widget
 * renders identically live and from history.
 */
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
  const [presetName, setPresetName] = useState('');
  const createPreset = useCreatePreset();

  const busy = stream.isLoading;
  // The values view: root state unioned with live `criterion_evaluated` custom
  // events, so criteria rows/counters stream in ahead of the superstep barrier.
  const { byName } = useCriterionEvents(stream);
  const view = useMemo(
    () => mergeLiveEvaluations(stream.values as Record<string, unknown>, byName),
    [stream.values, byName],
  );
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
  const discovered = useSubgraphRows(agent, stream as never);
  const subagentRuns: SubagentRun[] = [
    ...(captured ? Object.values(captured) : []),
    ...discovered.map((row) => ({
      name: row.label,
      status: row.status,
      renderDetail: () => <SubgraphDetail stream={stream} row={row} />,
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
    <ToolCacheProvider thread={liveThreadId} busy={busy}>
      <View className="gap-4">
      {/* Inputs — collapsed once there is a result so the output leads. The key
          remounts the section when the result first lands (streamed live or
          hydrated from history), since defaultOpen is initial-only. */}
      <Collapsible
        key={hasResult ? 'result' : 'fresh'}
        title={agent.title}
        icon={agent.icon}
        defaultOpen={!hasResult}
        headerRight={
          busy || stream.isThreadLoading ? (
            <ActivityIndicator size="small" color={palette.frosting[400]} />
          ) : undefined
        }>
        <View className="gap-3">
          <Text variant="muted">{agent.tagline}</Text>
          {agent.inputs.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              autoCapitalize={f.autoCapitalize}
              autoCorrect={false}
              value={values[f.key] ?? ''}
              onChangeText={(v) => setEdits((s) => ({ ...s, [f.key]: v }))}
            />
          ))}

          {agent.advanced?.length ? (
            <AdvancedOptions
              fields={agent.advanced}
              values={advanced}
              onChange={(k, v) => setAdvanced((s) => ({ ...s, [k]: v }))}
            />
          ) : null}

          {signInRequired ? (
            <SignInToRunNotice />
          ) : (
            <>
              <Button
                title={busy ? 'Running…' : hasResult ? 'Run again' : 'Run agent'}
                loading={busy}
                disabled={!canRun || busy}
                onPress={run}
              />
              {busy ? <Button title="Stop" variant="ghost" onPress={() => stream.stop()} /> : null}
            </>
          )}
        </View>
      </Collapsible>

      <Collapsible title="Save as preset" icon="sparkle">
        <View className="gap-2">
          <Text variant="muted">
            Save this graph + the current advanced options as a reusable assistant. API keys stay on
            this device — only non-secret settings are stored.
          </Text>
          <Field
            placeholder="Preset name"
            autoCapitalize="none"
            value={presetName}
            onChangeText={setPresetName}
          />
          <Button
            title="Save preset"
            variant="secondary"
            loading={createPreset.isPending}
            disabled={!presetName.trim() || createPreset.isPending}
            onPress={() =>
              createPreset.mutate(
                {
                  graphId: agent.id,
                  name: presetName.trim(),
                  configurable: {
                    ...buildPresetConfigurable(getSettings()),
                    ...buildOverrides(agent.advanced, advanced),
                  },
                },
                { onSuccess: () => setPresetName('') },
              )
            }
          />
          {createPreset.isSuccess ? <Text variant="muted">Preset saved ✓</Text> : null}
          {createPreset.isError ? (
            <Text variant="muted">Could not save preset — check the API URL / auth in Settings.</Text>
          ) : null}
        </View>
      </Collapsible>

      {stream.error ? (
        <Card tone="outline" className="gap-1">
          <Badge label="error" tone="bearish" />
          <Text variant="muted">
            {stream.error instanceof Error ? stream.error.message : String(stream.error)}
          </Text>
        </Card>
      ) : null}

      {stream.isThreadLoading ? (
        /* Reopened thread, state fetch in flight — hold the layout's shape. */
        <HydrationSkeleton agent={agent} />
      ) : (
        <>
          {/* Done / doing / next — driven by subgraph discovery while it streams. */}
          <RunProgress
            agent={agent}
            values={view}
            todos={(view as { todos?: Todo[] } | undefined)?.todos}
            busy={busy}
            byNode={stream.subgraphsByNode}
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
              cache (ToolCacheProvider) to show the full gathered payload + size +
              timestamp on expand — this folds in the former "Data gathered" panel.
              Grows live for criteria — the merged view's evaluations carry each
              worker's tool_runs. */}
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
      )}
      </View>
    </ToolCacheProvider>
  );
}
