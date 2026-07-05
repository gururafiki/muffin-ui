import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AdvancedOptions } from '@/components/advanced-options';
import { Badge, Button, Card, Collapsible, Field, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useCall } from '@/features/agent-calls/use-calls';
import { useCreatePreset } from '@/features/presets/use-presets';
import { SignInToRunNotice, useSignInRequiredToRun } from '@/features/account/run-gate';
import { CollectedData } from '@/features/agent-chat/collected-data';
import { Conversation, SubagentActivity, type SubagentRun, type SubagentRuns } from '@/features/agent-chat/conversation';
import { RunProgress } from '@/features/agent-chat/run-progress';
import type { RunMetadataStorage } from '@/features/agent-chat/use-active-run';
import { useAgentStream } from '@/features/agent-chat/use-agent-stream';
import { useSubagentRuns } from '@/features/agent-chat/use-subagent-runs';
import type { AgentDef } from '@/lib/agent/registry';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import { CriteriaResult, ResearchResult, StructuredOutput, TradingResult, type Todo } from '@/lib/agent/renderers';
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
 * Single-shot agent run screen (research / criteria / trading). Thread-scoped
 * via `useAgentStream`: hitting Run creates a thread and streams its `values`
 * into the URL, so a refresh resumes and reopening from Calls reuses this exact
 * screen. The result widget renders from `stream.values`, identically whether it
 * is streaming live or hydrated from history.
 */
export function AgentRunner({
  agent,
  initialValues,
  autoStart,
  threadId,
  assistantId,
  attachStorage,
}: {
  agent: AgentDef;
  initialValues?: Record<string, string>;
  autoStart?: boolean;
  /** Reopen a past run (from the Calls tab / a refresh). */
  threadId?: string;
  /** Run a saved preset assistant instead of the bare graph. */
  assistantId?: string;
  /** Pre-seeded reconnect storage — attaches to a live run on this thread. */
  attachStorage?: RunMetadataStorage;
}) {
  // `threadId` (the prop) is pinned at screen mount — undefined for a fresh run.
  // `liveThreadId` follows the run: useAgentStream updates it via onThreadId when
  // a new thread is created, so per-thread data hooks below attach to the live run
  // without re-gating (and unmounting) the screen.
  const {
    stream,
    submitRun,
    liveNode,
    threadId: liveThreadId,
  } = useAgentStream(agent, { assistantId, threadId, attachStorage });
  const [edits, setEdits] = useState<Record<string, string>>(initialValues ?? {});
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));
  const [presetName, setPresetName] = useState('');
  const createPreset = useCreatePreset();

  const busy = stream.isLoading;
  const result = agent.resultKey ? (stream.values as Record<string, unknown> | undefined)?.[agent.resultKey] : stream.values;
  const hasResult = isNonEmpty(result);

  // Effective form values: the reopened run's inputs (from streamed state),
  // overridden by anything the user types.
  const savedInputs = useMemo(() => {
    const v = stream.values as Record<string, unknown> | undefined;
    const out: Record<string, string> = {};
    if (v) for (const f of agent.inputs) if (typeof v[f.key] === 'string') out[f.key] = v[f.key] as string;
    return out;
  }, [stream.values, agent.inputs]);
  const values = useMemo(() => ({ ...savedInputs, ...edits }), [savedInputs, edits]);

  const signInRequired = useSignInRequiredToRun();
  const canRun = useMemo(
    () => agent.inputs.every((f) => !f.required || (values[f.key]?.trim()?.length ?? 0) > 0),
    [agent.inputs, values],
  );

  // Sub-agent internal timelines: captured deep-agent transcripts (parent state)
  // + native subgraph sub-agents (trading analysts) fetched from history.
  const captured = (stream.values as { subagent_runs?: SubagentRuns } | undefined)?.subagent_runs;
  const native = useSubagentRuns(liveThreadId).data;
  const subagentRuns: SubagentRun[] = [...(captured ? Object.values(captured) : []), ...(native ?? [])];

  // Thread record → the run's time window for the data-gathered panel.
  const { data: threadRec } = useCall(liveThreadId);

  const run = () => submitRun(agent.buildInput(values), { overrides: buildOverrides(agent.advanced, advanced), inputs: values });

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
    <View className="gap-4">
      {/* Inputs — collapsed once there is a result so the output leads. */}
      <Collapsible
        title={agent.title}
        icon={agent.icon}
        defaultOpen={!hasResult}
        headerRight={busy ? <ActivityIndicator size="small" color={palette.frosting[400]} /> : undefined}>
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

      {/* Done / doing / next — the run's heartbeat while it streams. */}
      <RunProgress
        agent={agent}
        values={stream.values as Record<string, unknown> | undefined}
        todos={(stream.values as { todos?: Todo[] } | undefined)?.todos}
        liveNode={liveNode}
        busy={busy}
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

      {/* What was fetched from data providers during this run. */}
      <CollectedData
        thread={liveThreadId}
        values={stream.values as Record<string, unknown> | undefined}
        busy={busy}
        windowStart={threadRec?.created_at}
        windowEnd={busy ? undefined : threadRec?.updated_at}
      />

      {/* Sub-agent activity (deep agents like criteria) — captured transcripts. */}
      <SubagentActivity runs={subagentRuns} />
    </View>
  );
}
