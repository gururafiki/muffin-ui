import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { AdvancedOptions } from '@/components/advanced-options';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, Card, Field, Text } from '@/components/ui';
import { threadInputs } from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { Conversation, SubagentActivity, SubagentStateDigest } from '@/features/agent-chat/conversation';
import { RunProgress } from '@/features/agent-chat/run-progress';
import type { RunMetadataStorage } from '@/features/agent-chat/use-active-run';
import { useAgentStream, type LiveNode } from '@/features/agent-chat/use-agent-stream';
import { useSubagentRuns } from '@/features/agent-chat/use-subagent-runs';
import { palette } from '@/theme/colors';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { CouncilArena } from './council-arena';
import { JudgePanel } from './judge-panel';
import { COUNCIL_PERSONAS, getPersonaMeta, normalizeSlug } from './personas';
import { SUBNODE_STAGE, signalTone, type PersonaSignal, type PersonaStage, type VoteTally } from './types';
import { VoteBar } from './vote-bar';

/** Derive every persona's arena view (stage/signal/tally) from streamed state. */
function deriveCouncil(
  values: Record<string, unknown> | undefined,
  liveNode: LiveNode | undefined,
  busy: boolean,
): {
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

  // The live node tells us which persona is on which internal step right now.
  const liveSlug = liveNode ? normalizeSlug(liveNode.namespace[0]?.split(':')[0] ?? '') : '';
  const liveStage: PersonaStage = (liveNode && SUBNODE_STAGE[liveNode.node]) || 'thinking';

  const stages = Object.fromEntries(
    COUNCIL_PERSONAS.map((p) => {
      if (signals[p.slug]) return [p.slug, 'done' as PersonaStage];
      if (!busy) return [p.slug, 'pending' as PersonaStage];
      return [p.slug, p.slug === liveSlug ? liveStage : ('thinking' as PersonaStage)];
    }),
  );
  const synthesis = (values?.council_synthesis as Record<string, unknown>) ?? null;
  return { signals, stages, synthesis, tally };
}

/**
 * The council chamber. Thread-scoped via `useAgentStream`: convening pushes the
 * thread into the URL, refreshing or reopening a live session drops you back
 * into the arena mid-deliberation, and history renders from the same state.
 */
export function CouncilScreen({
  agent,
  threadId,
  attachStorage,
}: {
  agent: AgentDef;
  threadId?: string;
  attachStorage?: RunMetadataStorage;
}) {
  const [tickerEdit, setTicker] = useState<string | null>(null);
  const [queryEdit, setQuery] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));

  const { stream, submitRun, liveNode } = useAgentStream(agent, { threadId, attachStorage });
  const values = stream.values as Record<string, unknown> | undefined;
  const busy = stream.isLoading;

  // Prefill inputs from thread metadata (Calls reopen) or streamed state.
  const { data: savedThread } = useCall(threadId);
  const savedInputs = savedThread ? threadInputs(savedThread) : undefined;
  const ticker = tickerEdit ?? savedInputs?.ticker ?? (values?.ticker as string | undefined) ?? '';
  const query = queryEdit ?? savedInputs?.query ?? '';

  const { signals, stages, synthesis, tally } = useMemo(
    () => deriveCouncil(values, liveNode, busy),
    [values, liveNode, busy],
  );
  const judging = busy && Object.keys(signals).length >= COUNCIL_PERSONAS.length && !synthesis;

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

  const convene = () => {
    setSelected(null);
    submitRun(agent.buildInput({ ticker, query }), {
      overrides: buildOverrides(agent.advanced, advanced),
      inputs: { ticker, ...(query ? { query } : {}) },
    });
  };

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
          title={busy ? 'In session…' : 'Convene the council'}
          loading={busy}
          disabled={!ticker.trim() || busy}
          onPress={convene}
        />
        {busy ? <Button title="Stop" variant="ghost" onPress={() => stream.stop()} /> : null}
      </Card>

      {stream.error ? (
        <Card tone="outline" className="gap-1">
          <Badge label="error" tone="bearish" />
          <Text variant="muted">
            {stream.error instanceof Error ? stream.error.message : String(stream.error)}
          </Text>
        </Card>
      ) : null}

      {busy ? (
        <RunProgress agent={agent} values={values} liveNode={liveNode} busy={busy} />
      ) : null}

      {busy || totalVotes > 0 ? (
        <Card className="gap-2">
          <VoteBar tally={tally} />
        </Card>
      ) : null}

      {busy || totalVotes > 0 ? (
        <CouncilArena
          stages={stages}
          signals={signals}
          selected={selected}
          onSelect={(slug) => setSelected((cur) => (cur === slug ? null : slug))}
          active={busy}
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

      {selected && (selRun?.stateValues || selRun?.messages?.length) ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <Card tone="muted" className="gap-3">
            <Text variant="label">How {selMeta?.name ?? 'they'} worked</Text>
            <SubagentStateDigest values={selRun.stateValues} />
            {selRun.messages?.length ? <Conversation messages={selRun.messages} viewMode="verbose" /> : null}
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
