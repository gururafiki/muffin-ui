import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import type { SubgraphDiscoverySnapshot } from '@langchain/langgraph-sdk/stream';

import { AdvancedOptions } from '@/components/advanced-options';
import { Button, Card, Field, Screen, Skeleton } from '@/components/ui';
import { useSignInRequiredToRun } from '@/features/account/run-gate';
import { useCall } from '@/features/agent-calls/use-calls';
import { useAgentView } from '@/features/agent-shared/agent-view-store';
import { AgentHero } from '@/features/agent-shared/agent-hero';
import { ExecutionTree } from '@/features/agent-shared/execution-tree/execution-tree';
import { RunProgress } from '@/features/agent-shared/run-progress';
import { useSubgraphRows } from '@/features/agent-shared/run-projections';
import { RunRecap } from '@/features/agent-shared/run-recap';
import { RunViewToggle } from '@/features/agent-shared/run-view-toggle';
import { HydrationCard, RunErrorCard, RunSurface } from '@/features/agent-shared/run-surface';
import { SubagentActivity } from '@/features/agent-shared/subagent-activity';
import { SubgraphDetail } from '@/features/agent-shared/subgraph-detail';
import { useRunStream } from '@/features/agent-shared/use-run-stream';
import { buildOverrides, initialOverrides } from '@/lib/agent/overrides';
import type { AgentDef } from '@/lib/agent/registry';
import { parseArray, zPersonaSignal } from '@/lib/agent/schemas';
import { useRunTreeRoot } from '@/features/agent-shared/use-run-tree';
import { CouncilArena } from './council-arena';
import { useCouncilLive, type PersonaLive } from './council-live';
import { JudgePanel } from './judge-panel';
import { findMemberNode, MemberDetail } from './member-detail';
import {
  COUNCIL_MEMBERS,
  COUNCIL_PERSONAS,
  COUNCIL_SPECIALISTS,
  getPersonaMeta,
  MEMBER_SLUGS,
  normalizeSlug,
  type PersonaMeta,
} from './personas';
import { signalTone, type PersonaSignal, type PersonaStage, type VoteTally } from './types';
import { VoteBar } from './vote-bar';

/**
 * Derive every member's arena view (stage/signal/tally). Root
 * `values.persona_signals` is authoritative (barrier / history); mid-run the
 * per-member live fold (namespaced values events) and subgraph-discovery
 * statuses fill the gap — both are monotone, so seats never regress.
 *
 * Specialists are optional per run (`include_specialists`, all six or none):
 * their seats join the grid when any specialist shows up in signals / live
 * events / discovery, or — before any events land — when the toggle says a
 * fresh run asked for them.
 */
function deriveCouncil(
  values: Record<string, unknown> | undefined,
  live: Map<string, PersonaLive>,
  byNode: ReadonlyMap<string, readonly SubgraphDiscoverySnapshot[]> | undefined,
  busy: boolean,
  wantSpecialists: boolean,
): {
  members: PersonaMeta[];
  signals: Record<string, PersonaSignal>;
  stages: Record<string, PersonaStage>;
  synthesis: Record<string, unknown> | null;
  tally: VoteTally;
} {
  const signals: Record<string, PersonaSignal> = {};
  for (const [slug, entry] of live) if (entry.signal) signals[slug] = entry.signal;
  for (const sig of parseArray(zPersonaSignal, values?.persona_signals, 'persona_signals')) {
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

  const specialistsPresent =
    COUNCIL_SPECIALISTS.some(
      (s) => signals[s.slug] || live.has(s.slug) || discovered.has(s.slug),
    ) ||
    (busy && wantSpecialists);
  const members = specialistsPresent ? COUNCIL_MEMBERS : COUNCIL_PERSONAS;

  const stages = Object.fromEntries(
    members.map((p) => {
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
  return { members, signals, stages, synthesis, tally };
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
  // Pre-submit draft only — never merged with the reopened run's saved
  // ticker/query. A reopened/finished session shows those via the read-only
  // `RunRecap` instead.
  const [tickerDraft, setTickerDraft] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(() => initialOverrides(agent.advanced));

  // `threadId` (prop) is pinned at mount; `liveThreadId` follows a fresh run so
  // per-thread hooks attach live without re-gating (see agent-runner + the route).
  const { stream, submitRun, threadId: liveThreadId } = useRunStream(agent, { threadId });
  const values = stream.values as Record<string, unknown> | undefined;
  const busy = stream.isLoading;
  const signInRequired = useSignInRequiredToRun();
  // Bespoke council arena (default) vs the generic Execution-tree view.
  const agentView = useAgentView(agent.id);

  // The reopened/submitted session's actual ticker/query, straight from
  // streamed state — shown read-only via `RunRecap`. The run input lands in
  // the graph state, so no client-tagged metadata is needed — `stream.values`
  // hydrates on reopen; `savedThread.values` is the fallback until it does.
  const { data: savedThread } = useCall(liveThreadId);
  const savedValues = savedThread?.values as Record<string, unknown> | undefined;
  const asStr = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const savedTicker = asStr(values?.ticker) ?? asStr(savedValues?.ticker) ?? '';
  const savedQuery = asStr(values?.query) ?? asStr(savedValues?.query) ?? '';

  const live = useCouncilLive(stream);
  const wantSpecialists = Boolean(advanced.include_specialists);
  const { members, signals, stages, synthesis, tally } = useMemo(
    () => deriveCouncil(values, live, stream.subgraphsByNode, busy, wantSpecialists),
    [values, live, stream.subgraphsByNode, busy, wantSpecialists],
  );

  // The run's top-level execution steps, read once from LangGraph's own
  // checkpoints. `MemberDetail` picks out the selected member's node; expanding
  // it reads that member's namespace for its transcript, tool calls and
  // sub-agents.
  const { data: topology } = useRunTreeRoot(liveThreadId, busy);
  const judging = busy && Object.keys(signals).length >= members.length && !synthesis;

  const totalVotes = tally.bullish + tally.bearish + tally.neutral;
  const selSignal = selected ? signals[selected] : undefined;
  const selMeta = selected ? getPersonaMeta(selected) : undefined;

  // Discovered subgraph rows. Known members (personas + specialists) surface
  // in the arena / member detail; anything else — a future graph node the UI
  // doesn't know yet — falls back to the generic sub-agents panel.
  const discovered = useSubgraphRows(agent, stream);
  const selRow = selected ? discovered.find((r) => normalizeSlug(r.nodeName) === selected) : undefined;
  const selLive = selected ? live.get(selected) : undefined;
  const selNode = selected ? findMemberNode(topology, selected) : undefined;
  const unknownRuns = discovered
    .filter((r) => !MEMBER_SLUGS.has(normalizeSlug(r.nodeName)) && r.nodeName !== 'council_judge')
    .map((row) => ({
      name: row.label,
      status: row.status,
      renderDetail: () => <SubgraphDetail row={row} />,
    }));

  const convene = () => {
    setSelected(null);
    submitRun(agent.buildInput({ ticker: tickerDraft, query: queryDraft }), {
      overrides: buildOverrides(agent.advanced, advanced),
    });
  };

  // Nothing to show yet but the landing hero: no thread pinned, not busy, no
  // votes in, and (for a reopened session) not still hydrating.
  const isFreshRun = !threadId && !busy && totalVotes === 0 && !stream.isThreadLoading;

  if (isFreshRun) {
    return (
      <AgentHero
        agent={agent}
        signInRequired={signInRequired}
        examples={agent.exampleConfigs?.map((cfg) => ({
          label: cfg.label,
          onPress: () => {
            setTickerDraft(cfg.values.ticker ?? '');
            setQueryDraft(cfg.values.query ?? '');
          },
        }))}>
        <View className="gap-3">
          <Field
            label="Ticker"
            placeholder="AAPL"
            autoCapitalize="characters"
            autoCorrect={false}
            value={tickerDraft}
            onChangeText={setTickerDraft}
          />
          <Field
            label="Focus (optional)"
            placeholder="Is the moat durable?"
            value={queryDraft}
            onChangeText={setQueryDraft}
          />
          {agent.advanced?.length ? (
            <AdvancedOptions
              fields={agent.advanced}
              values={advanced}
              onChange={(k, v) => setAdvanced((s) => ({ ...s, [k]: v }))}
            />
          ) : null}
          <Button title="Convene the council" disabled={!tickerDraft.trim()} onPress={convene} />
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
        values={{ ticker: savedTicker, query: savedQuery }}
        busy={busy}
        loading={stream.isThreadLoading}
        onStop={() => stream.stop()}
      />

      <RunViewToggle agentId={agent.id} />

      <RunErrorCard error={stream.error} />

      {stream.isThreadLoading ? (
        /* Reopened session hydrating — hold the arena's shape. */
        <HydrationCard label="Loading this session…">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-24 w-full" />
        </HydrationCard>
      ) : null}

      {busy ? (
        <RunProgress agent={agent} values={values} busy={busy} byNode={stream.subgraphsByNode} />
      ) : null}

      {agentView === 'tree' ? (
        <ExecutionTree
          agent={agent}
          values={values ?? {}}
          busy={busy}
          byNode={stream.subgraphsByNode}
          threadId={liveThreadId}
        />
      ) : (
        <>
      {busy || totalVotes > 0 ? (
        <Card className="gap-2">
          <VoteBar tally={tally} seats={members.length} />
        </Card>
      ) : null}

      {busy || totalVotes > 0 ? (
        <CouncilArena
          members={members}
          stages={stages}
          signals={signals}
          selected={selected}
          onSelect={(slug) => setSelected((cur) => (cur === slug ? null : slug))}
          active={busy}
        />
      ) : null}

      {selected && selMeta ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <MemberDetail
            meta={selMeta}
            signal={selSignal}
            stage={stages[selected] ?? 'pending'}
            busy={busy}
            liveValues={selLive?.values}
            row={selRow}
            node={selNode}
            threadId={liveThreadId}
            onDismiss={() => setSelected(null)}
          />
        </Animated.View>
      ) : null}

      {/* Safety net: discovered nodes the UI has no member metadata for yet. */}
      {unknownRuns?.length ? <SubagentActivity runs={unknownRuns} /> : null}

      {/* No run-wide tool roll-up here: a member's tool calls belong to that
          member, and live under its row (tap a member → its namespace is read on
          demand). Rebuilding a council-wide roll-up would mean walking all 19
          namespaces eagerly for a summary nobody asked for. */}

      {judging || synthesis ? (
        <Animated.View entering={FadeInDown.duration(300)}>
          <JudgePanel synthesis={synthesis} judging={judging} />
        </Animated.View>
      ) : null}
        </>
      )}
    </View>
    </RunSurface>
    </Screen>
  );
}
