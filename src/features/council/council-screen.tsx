import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import type { SubgraphDiscoverySnapshot } from '@langchain/langgraph-sdk/stream';

import { AdvancedOptions } from '@/components/advanced-options';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, Card, Field, Text } from '@/components/ui';
import { SignInToRunNotice, useSignInRequiredToRun } from '@/features/account/run-gate';
import { threadInputs } from '@/features/agent-calls/threads';
import { useCall } from '@/features/agent-calls/use-calls';
import { SubagentActivity, SubagentStateDigest } from '@/features/agent-chat/conversation';
import { RunProgress } from '@/features/agent-chat/run-progress';
import { useSubgraphRows } from '@/features/agent-chat/run-projections';
import { SubgraphDetail } from '@/features/agent-chat/subgraph-detail';
import { useRunStream } from '@/features/agent-chat/use-run-stream';
import { palette } from '@/theme/colors';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { CouncilArena } from './council-arena';
import { useCouncilLive, type PersonaLive } from './council-live';
import { JudgePanel } from './judge-panel';
import { COUNCIL_PERSONAS, getPersonaMeta, normalizeSlug } from './personas';
import { signalTone, type PersonaSignal, type PersonaStage, type VoteTally } from './types';
import { VoteBar } from './vote-bar';

/**
 * Derive every persona's arena view (stage/signal/tally). Root
 * `values.persona_signals` is authoritative (barrier / history); mid-run the
 * per-persona live fold (namespaced values events) and subgraph-discovery
 * statuses fill the gap — both are monotone, so seats never regress.
 */
function deriveCouncil(
  values: Record<string, unknown> | undefined,
  live: Map<string, PersonaLive>,
  byNode: ReadonlyMap<string, readonly SubgraphDiscoverySnapshot[]> | undefined,
  busy: boolean,
): {
  signals: Record<string, PersonaSignal>;
  stages: Record<string, PersonaStage>;
  synthesis: Record<string, unknown> | null;
  tally: VoteTally;
} {
  const signals: Record<string, PersonaSignal> = {};
  for (const [slug, entry] of live) if (entry.signal) signals[slug] = entry.signal;
  for (const sig of (values?.persona_signals as PersonaSignal[] | undefined) ?? []) {
    const slug = normalizeSlug(sig.agent_id);
    if (slug) signals[slug] = sig;
  }
  const tally: VoteTally = { bullish: 0, bearish: 0, neutral: 0 };
  for (const sig of Object.values(signals)) tally[signalTone(sig.signal)] += 1;

  const discovered = new Map<string, SubgraphDiscoverySnapshot>();
  if (byNode) {
    for (const [node, snaps] of byNode) {
      const slug = normalizeSlug(node);
      if (slug && snaps.length) discovered.set(slug, snaps[snaps.length - 1]);
    }
  }

  const stages = Object.fromEntries(
    COUNCIL_PERSONAS.map((p) => {
      if (signals[p.slug]) return [p.slug, 'done' as PersonaStage];
      const liveStage = live.get(p.slug)?.stage;
      if (busy && liveStage) return [p.slug, liveStage];
      const snap = discovered.get(p.slug);
      if (snap?.status === 'running' && busy) return [p.slug, 'collecting' as PersonaStage];
      if (snap && snap.status !== 'running') return [p.slug, 'done' as PersonaStage];
      return [p.slug, busy ? ('thinking' as PersonaStage) : ('pending' as PersonaStage)];
    }),
  );
  const synthesis = (values?.council_synthesis as Record<string, unknown>) ?? null;
  return { signals, stages, synthesis, tally };
}

/**
 * The council chamber. Thread-scoped via `useRunStream`: convening pushes the
 * thread into the URL, refreshing or reopening a live session drops you back
 * into the arena mid-deliberation, and history renders from the same state.
 */
export function CouncilScreen({
  agent,
  threadId,
}: {
  agent: AgentDef;
  threadId?: string;
}) {
  const [tickerEdit, setTicker] = useState<string | null>(null);
  const [queryEdit, setQuery] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));

  // `threadId` (prop) is pinned at mount; `liveThreadId` follows a fresh run so
  // per-thread hooks attach live without re-gating (see agent-runner + the route).
  const { stream, submitRun, threadId: liveThreadId } = useRunStream(agent, { threadId });
  const values = stream.values as Record<string, unknown> | undefined;
  const busy = stream.isLoading;
  const signInRequired = useSignInRequiredToRun();

  // Prefill inputs from thread metadata (Calls reopen) or streamed state.
  const { data: savedThread } = useCall(liveThreadId);
  const savedInputs = savedThread ? threadInputs(savedThread) : undefined;
  const ticker = tickerEdit ?? savedInputs?.ticker ?? (values?.ticker as string | undefined) ?? '';
  const query = queryEdit ?? savedInputs?.query ?? '';

  const live = useCouncilLive(stream);
  const { signals, stages, synthesis, tally } = useMemo(
    () => deriveCouncil(values, live, stream.subgraphsByNode, busy),
    [values, live, stream.subgraphsByNode, busy],
  );
  const judging = busy && Object.keys(signals).length >= COUNCIL_PERSONAS.length && !synthesis;

  const totalVotes = tally.bullish + tally.bearish + tally.neutral;
  const selSignal = selected ? signals[selected] : undefined;
  const selMeta = selected ? getPersonaMeta(selected) : undefined;

  // Discovered subgraph rows. Personas surface in the arena / persona detail;
  // any non-persona row is an added specialist (valuation, news-sentiment, …)
  // shown in its own panel with a live scoped transcript.
  const discovered = useSubgraphRows(agent, stream as never);
  const personaSlugs = useMemo(() => new Set(COUNCIL_PERSONAS.map((p) => p.slug)), []);
  const selRow = selected ? discovered.find((r) => normalizeSlug(r.nodeName) === selected) : undefined;
  const selLive = selected ? live.get(selected) : undefined;
  const specialistRuns = discovered
    .filter((r) => !personaSlugs.has(normalizeSlug(r.nodeName)) && r.nodeName !== 'council_judge')
    .map((row) => ({
      name: row.label,
      status: row.status,
      renderDetail: () => <SubgraphDetail stream={stream} row={row} />,
    }));

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
        {signInRequired ? (
          <SignInToRunNotice />
        ) : (
          <>
            <Button
              title={busy ? 'In session…' : 'Convene the council'}
              loading={busy}
              disabled={!ticker.trim() || busy}
              onPress={convene}
            />
            {busy ? <Button title="Stop" variant="ghost" onPress={() => stream.stop()} /> : null}
          </>
        )}
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
        <RunProgress agent={agent} values={values} busy={busy} byNode={stream.subgraphsByNode} />
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

      {selected && (selRow || selLive?.values) ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <Card tone="muted" className="gap-3">
            <Text variant="label">How {selMeta?.name ?? 'they'} worked</Text>
            <SubagentStateDigest values={selLive?.values} />
            {selRow ? <SubgraphDetail stream={stream} row={selRow} /> : null}
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
