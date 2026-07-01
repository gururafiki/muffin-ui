import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AdvancedOptions } from '@/components/advanced-options';
import { Badge, Button, Card, Collapsible, Field, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useCreatePreset } from '@/features/presets/use-presets';
import { SubagentActivity, type SubagentRuns } from '@/features/agent-chat/conversation';
import { useAgentStream } from '@/features/agent-chat/use-agent-stream';
import type { AgentDef } from '@/lib/agent/registry';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import { CriteriaResult, ResearchResult, StructuredOutput, TradingResult } from '@/lib/agent/renderers';
import { buildPresetConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';

const RESULT_RENDERERS: Record<string, (value: unknown) => React.ReactNode> = {
  research: (value) => <ResearchResult value={value} />,
  criteria: (value) => <CriteriaResult value={value} />,
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
}: {
  agent: AgentDef;
  initialValues?: Record<string, string>;
  autoStart?: boolean;
  /** Reopen a past run (from the Calls tab / a refresh). */
  threadId?: string;
  /** Run a saved preset assistant instead of the bare graph. */
  assistantId?: string;
}) {
  const { stream, submitRun } = useAgentStream(agent, { assistantId, threadId });
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

  const canRun = useMemo(
    () => agent.inputs.every((f) => !f.required || (values[f.key]?.trim()?.length ?? 0) > 0),
    [agent.inputs, values],
  );

  const subagentRuns = (stream.values as { subagent_runs?: SubagentRuns } | undefined)?.subagent_runs;

  const run = () => submitRun(agent.buildInput(values), { overrides: buildOverrides(agent.advanced, advanced), inputs: values });

  // Deep-link autostart ("Analyse" from a stock) — only for a fresh thread.
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !threadId && !started.current && canRun) {
      started.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, canRun, threadId]);

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

          <Button
            title={busy ? 'Running…' : hasResult ? 'Run again' : 'Run agent'}
            loading={busy}
            disabled={!canRun || busy}
            onPress={run}
          />
          {busy ? <Button title="Stop" variant="ghost" onPress={() => stream.stop()} /> : null}
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

      {busy && !hasResult ? (
        <View className="flex-row items-center gap-2 px-1">
          <ActivityIndicator size="small" color={palette.frosting[400]} />
          <Text variant="muted" className="text-sm">Working…</Text>
        </View>
      ) : null}

      {/* Headline result — same widget live and from history. */}
      {hasResult ? (
        agent.resultRenderer && RESULT_RENDERERS[agent.resultRenderer] ? (
          RESULT_RENDERERS[agent.resultRenderer](result)
        ) : (
          <Card className="gap-2">
            <Badge label={busy ? 'streaming result' : 'result'} tone="info" />
            <StructuredOutput value={result} />
          </Card>
        )
      ) : null}

      {/* Sub-agent activity (deep agents like criteria) — captured transcripts. */}
      <SubagentActivity runs={subagentRuns} />
    </View>
  );
}
