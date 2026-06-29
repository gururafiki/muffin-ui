import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AdvancedOptions } from '@/components/advanced-options';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, Collapsible, Field, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { threadInputs } from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { useCreatePreset } from '@/features/presets/use-presets';
import type { AgentDef } from '@/lib/agent/registry';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import {
  CriteriaResult,
  ResearchResult,
  StructuredOutput,
  TimelineItemCard,
  TradingResult,
} from '@/lib/agent/renderers';
import { useAgentRun } from '@/lib/agent/use-agent-run';
import type { RunState } from '@/lib/agent/types';
import { buildPresetConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';

type RunnerRender = (run: RunState) => React.ReactNode;

const RESULT_RENDERERS: Record<string, (value: unknown) => React.ReactNode> = {
  research: (value) => <ResearchResult value={value} />,
  criteria: (value) => <CriteriaResult value={value} />,
  trading: (value) => <TradingResult value={value} />,
};

/**
 * Generic agent run screen: collects the agent's declared inputs, kicks a run,
 * and renders the streamed timeline + final structured output. Supports
 * `initialValues` + `autoStart` (used by "Analyse" deep links) and a custom
 * `renderResult` (used by the council screen).
 */
export function AgentRunner({
  agent,
  renderResult,
  initialValues,
  autoStart,
  threadId,
  assistantId,
}: {
  agent: AgentDef;
  renderResult?: RunnerRender;
  initialValues?: Record<string, string>;
  autoStart?: boolean;
  /** Reopen a past run: seed the saved result + inputs from this thread. */
  threadId?: string;
  /** Run a saved preset assistant instead of the bare graph (defaults to agent.id). */
  assistantId?: string;
}) {
  const [edits, setEdits] = useState<Record<string, string>>(initialValues ?? {});
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));
  const [presetName, setPresetName] = useState('');
  const createPreset = useCreatePreset();
  const run = useAgentRun(agent, assistantId);
  const { data: savedThread } = useCall(threadId);

  // Effective form values: the reopened thread's stored inputs, overridden by
  // anything the user has typed. (Avoids seeding state from the async fetch.)
  const values = useMemo(
    () => ({ ...(savedThread ? threadInputs(savedThread) : undefined), ...edits }),
    [savedThread, edits],
  );
  const setValues = setEdits;

  const canRun = useMemo(
    () => agent.inputs.every((f) => !f.required || (values[f.key]?.trim()?.length ?? 0) > 0),
    [agent.inputs, values],
  );

  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current && canRun) {
      started.current = true;
      run.start(values, buildOverrides(agent.advanced, advanced));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, canRun]);

  const liveResult = agent.resultKey ? run.values?.[agent.resultKey] : run.values;
  // Until a fresh run starts, show the reopened thread's saved result.
  const savedValues = savedThread?.values as Record<string, unknown> | undefined;
  const savedResult =
    run.status === 'idle' && savedValues
      ? agent.resultKey
        ? savedValues[agent.resultKey]
        : savedValues
      : undefined;
  const result = liveResult ?? savedResult;
  const streaming = run.status === 'streaming';

  return (
    <View className="gap-4">
      <Card tone="sticker" className="gap-3">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
            <Icon name={agent.icon} size={26} color={palette.frosting[600]} />
          </View>
          <View className="flex-1">
            <Text variant="heading">{agent.title}</Text>
            <Text variant="muted">{agent.tagline}</Text>
          </View>
        </View>

        {agent.inputs.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            placeholder={f.placeholder}
            autoCapitalize={f.autoCapitalize}
            autoCorrect={false}
            value={values[f.key] ?? ''}
            onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
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
          title={streaming ? 'Running…' : 'Run agent'}
          loading={streaming}
          disabled={!canRun}
          onPress={() => run.start(values, buildOverrides(agent.advanced, advanced))}
        />
        {streaming ? (
          <Button title="Cancel" variant="ghost" onPress={run.cancel} />
        ) : null}
      </Card>

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

      {run.status === 'error' ? (
        <Card tone="outline" className="gap-1">
          <Badge label="error" tone="bearish" />
          <Text variant="muted">{run.error}</Text>
        </Card>
      ) : null}

      {run.polled ? (
        <Card tone="muted">
          <Text variant="muted">
            Live streaming was unavailable on this platform — showing the final result.
          </Text>
        </Card>
      ) : null}

      {/* Headline result */}
      {result ? (
        renderResult ? (
          renderResult(run)
        ) : agent.resultRenderer && RESULT_RENDERERS[agent.resultRenderer] ? (
          RESULT_RENDERERS[agent.resultRenderer](result)
        ) : (
          <Card className="gap-2">
            <Badge label={streaming ? 'streaming result' : 'result'} tone="info" />
            <StructuredOutput value={result} />
          </Card>
        )
      ) : null}

      {/* Streamed timeline */}
      {run.timeline.length > 0 ? (
        <View className="gap-2">
          <Text variant="label">Run timeline</Text>
          {run.timeline.map((item) => (
            <TimelineItemCard key={item.id} item={item} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
