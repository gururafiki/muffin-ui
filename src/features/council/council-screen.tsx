import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { AdvancedOptions } from '@/components/advanced-options';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, Card, Field, Text } from '@/components/ui';
import { threadInputs } from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { Conversation, SubagentActivity } from '@/features/agent-chat/conversation';
import { useSubagentRuns } from '@/features/agent-chat/use-subagent-runs';
import { palette } from '@/theme/colors';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { CouncilArena } from './council-arena';
import { JudgePanel } from './judge-panel';
import { COUNCIL_PERSONAS, getPersonaMeta, normalizeSlug } from './personas';
import {
  signalTone,
  useCouncilRun,
  type PersonaSignal,
  type PersonaStage,
  type VoteTally,
} from './use-council-run';
import { VoteBar } from './vote-bar';

export function CouncilScreen({ agent, threadId }: { agent: AgentDef; threadId?: string }) {
  const [tickerEdit, setTicker] = useState<string | null>(null);
  const [queryEdit, setQuery] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));
  const run = useCouncilRun();
  const { data: savedThread } = useCall(threadId);

  // Effective inputs: the reopened thread's stored inputs, overridden by edits.
  const savedInputs = savedThread ? threadInputs(savedThread) : undefined;
  const ticker = tickerEdit ?? savedInputs?.ticker ?? '';
  const query = queryEdit ?? savedInputs?.query ?? '';

  // Until a fresh session starts, render the reopened thread's saved verdict.
  const saved = useMemo(() => deriveSaved(savedThread?.values as Record<string, unknown> | undefined), [savedThread]);
  const live = run.status !== 'idle';

  const signals = live ? run.signals : saved.signals;
  const stages = live ? run.stages : saved.stages;
  const synthesis = live ? run.synthesis : saved.synthesis;
  const tally = live ? run.tally : saved.tally;
  const judging = live && run.judging;

  const streaming = run.status === 'streaming';
  const totalVotes = tally.bullish + tally.bearish + tally.neutral;
  const selSignal = selected ? signals[selected] : undefined;
  const selMeta = selected ? getPersonaMeta(selected) : undefined;

  // Native sub-agent timelines (persisted subgraphs). Personas surface in the
  // arena / persona detail; any non-persona run is an added specialist
  // (valuation, news-sentiment, …) shown in its own panel.
  const nativeRuns = useSubagentRuns(threadId).data;
  const selRun = selected ? nativeRuns?.find((r) => normalizeSlug(r.name ?? '') === selected) : undefined;
  const personaSlugs = useMemo(() => new Set(COUNCIL_PERSONAS.map((p) => p.slug)), []);
  const specialistRuns = nativeRuns?.filter((r) => !personaSlugs.has(normalizeSlug(r.name ?? '')));

  return (
    <View className="gap-4">
      <Card tone="sticker" className="gap-3">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
            <Icon name="council" size={26} color={palette.frosting[600]} />
          </View>
          <View className="flex-1">
            <Text variant="heading">Investor Council</Text>
            <Text variant="muted">13 legends debate, a judge decides.</Text>
          </View>
        </View>
        <Field
          label="Ticker"
          placeholder="AAPL"
          autoCapitalize="characters"
          autoCorrect={false}
          value={ticker}
          onChangeText={setTicker}
        />
        <Field
          label="Focus (optional)"
          placeholder="Is the moat durable?"
          value={query}
          onChangeText={setQuery}
        />
        {agent.advanced?.length ? (
          <AdvancedOptions
            fields={agent.advanced}
            values={advanced}
            onChange={(k, v) => setAdvanced((s) => ({ ...s, [k]: v }))}
          />
        ) : null}
        <Button
          title={streaming ? 'In session…' : 'Convene the council'}
          loading={streaming}
          disabled={!ticker.trim()}
          onPress={() => {
            setSelected(null);
            run.start({ ticker, query }, buildOverrides(agent.advanced, advanced));
          }}
        />
        {streaming ? <Button title="Cancel" variant="ghost" onPress={run.cancel} /> : null}
      </Card>

      {run.status === 'error' ? (
        <Card tone="outline" className="gap-1">
          <Badge label="error" tone="bearish" />
          <Text variant="muted">{run.error}</Text>
        </Card>
      ) : null}

      {run.polled ? (
        <Card tone="muted">
          <Text variant="muted">Live streaming was unavailable — showing the final result.</Text>
        </Card>
      ) : null}

      {streaming || totalVotes > 0 ? (
        <Card className="gap-2">
          <VoteBar tally={tally} />
        </Card>
      ) : null}

      {streaming || totalVotes > 0 ? (
        <CouncilArena
          stages={stages}
          signals={signals}
          selected={selected}
          onSelect={(slug) => setSelected((cur) => (cur === slug ? null : slug))}
          active={streaming}
        />
      ) : null}

      {selMeta ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <Pressable onPress={() => setSelected(null)}>
            <Card className="gap-2">
              <View className="flex-row items-center gap-3">
                <Avatar name={selMeta.name} size={44} />
                <View className="flex-1">
                  <Text variant="heading">{selMeta.name}</Text>
                  <Text variant="muted">{selMeta.style}</Text>
                </View>
                {selSignal?.signal ? <Badge label={selSignal.signal} tone={signalTone(selSignal.signal)} /> : null}
              </View>
              {typeof selSignal?.confidence === 'number' ? (
                <Text variant="muted">confidence {Math.round(selSignal.confidence * 100)}%</Text>
              ) : null}
              {selSignal?.reasoning ? (
                <Text variant="body">{selSignal.reasoning}</Text>
              ) : (
                <Text variant="muted">{selMeta.name} is still deliberating…</Text>
              )}
            </Card>
          </Pressable>
        </Animated.View>
      ) : null}

      {selRun?.messages?.length ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <Card tone="muted" className="gap-2">
            <Text variant="label">How {selMeta?.name ?? 'they'} reasoned</Text>
            <Conversation messages={selRun.messages} viewMode="verbose" />
          </Card>
        </Animated.View>
      ) : null}

      {specialistRuns?.length ? <SubagentActivity runs={specialistRuns} /> : null}

      {judging || synthesis ? (
        <Animated.View entering={FadeInDown.duration(300)}>
          <JudgePanel synthesis={synthesis} judging={judging} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Rebuild the council verdict (signals, stages, tally, synthesis) from saved thread state. */
function deriveSaved(values: Record<string, unknown> | undefined): {
  signals: Record<string, PersonaSignal>;
  stages: Record<string, PersonaStage>;
  synthesis: Record<string, unknown> | null;
  tally: VoteTally;
} {
  const list = (values?.persona_signals as PersonaSignal[] | undefined) ?? [];
  const signals: Record<string, PersonaSignal> = {};
  const tally: VoteTally = { bullish: 0, bearish: 0, neutral: 0 };
  for (const sig of list) {
    const slug = normalizeSlug(sig.agent_id);
    if (!slug) continue;
    signals[slug] = sig;
    tally[signalTone(sig.signal)] += 1;
  }
  const stages = Object.fromEntries(
    COUNCIL_PERSONAS.map((p) => [p.slug, (signals[p.slug] ? 'done' : 'pending') as PersonaStage]),
  );
  const synthesis = (values?.council_synthesis as Record<string, unknown>) ?? null;
  return { signals, stages, synthesis, tally };
}
