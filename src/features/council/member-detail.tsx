import { ActivityIndicator, Pressable, useColorScheme, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Collapsible, Text } from '@/components/ui';
import type { SubgraphRow } from '@/features/agent-shared/run-projections';
import { SubagentStateDigest } from '@/features/agent-shared/subagent-activity';
import { SubagentTree } from '@/features/agent-shared/subagent-tree';
import { SubgraphDetail } from '@/features/agent-shared/subgraph-detail';
import { Markdown, StructuredOutput } from '@/lib/agent/renderers';
import type { ExecNode } from '@/lib/agent/exec-tree';
import { palette } from '@/theme/colors';
import { normalizeSlug, type MemberStep, type PersonaMeta } from './personas';
import { signalTone, type PersonaSignal, type PersonaStage } from './types';

/**
 * The selected member's node in the run's root topology — matched on the graph
 * node name, since each persona/specialist is a compiled subgraph added via
 * `add_node`. `normalizeSlug` tolerates a differently-cased/hyphenated name the
 * backend might emit for the same member.
 *
 * That node owns a LangGraph namespace, so expanding it reads the member's own
 * transcript, the tool calls inside it, and the sub-agents it ran (`collect_data`
 * and below) — the drill-down that was previously invisible.
 */
export function findMemberNode(tree: ExecNode[] | undefined, slug: string): ExecNode | undefined {
  return tree?.find((r) => normalizeSlug(r.name ?? '') === slug);
}

/** Which of the member's inner steps a live stage sits on. */
const STAGE_STEP: Partial<Record<PersonaStage, number>> = {
  collecting: 0,
  scoring: 1,
  deciding: 2,
};

type StepState = 'done' | 'active' | 'pending';

function stepStates(steps: MemberStep[], stage: PersonaStage, settled: boolean): StepState[] {
  if (stage === 'done' || settled) return steps.map(() => 'done');
  const at = Math.min(STAGE_STEP[stage] ?? -1, steps.length - 1);
  return steps.map((_, i) => (i < at ? 'done' : i === at ? 'active' : 'pending'));
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  return (
    <View className="flex-row items-center gap-2">
      {state === 'done' ? (
        <Icon name="check-circle" size={16} weight="fill" color={palette.leaf[500]} />
      ) : state === 'active' ? (
        <ActivityIndicator size={14} color={palette.butter[500]} />
      ) : (
        <View className="ml-0.5 h-2.5 w-2.5 rounded-pill border border-frosting-300 dark:border-night-border" />
      )}
      <Text variant={state === 'pending' ? 'muted' : 'body'} className="text-sm">
        {label}
      </Text>
    </View>
  );
}

/**
 * The tap-to-expand detail card for one council member — persona or
 * specialist, the difference is purely metadata. Everything a member's run
 * left behind, in reading order: verdict header → step timeline → reasoning
 * (markdown) → typed evidence → the data it collected (tool runs joined to
 * the provider-call cache) → the live scoped transcript while streaming.
 */
export function MemberDetail({
  meta,
  signal,
  stage,
  busy,
  liveValues,
  row,
  node,
  threadId,
  onDismiss,
}: {
  meta: PersonaMeta;
  signal?: PersonaSignal;
  stage: PersonaStage;
  busy: boolean;
  liveValues?: Record<string, unknown>;
  row?: SubgraphRow;
  /** This member's node in the run's root topology (`council-screen.tsx`). */
  node?: ExecNode;
  threadId?: string;
  onDismiss: () => void;
}) {
  const dark = useColorScheme() === 'dark';
  // A committed verdict settles the timeline even when the live stage lags
  // (history threads never stream stages at all).
  const states = stepStates(meta.steps, stage, !!signal && !busy);
  const evidence =
    signal?.evidence && Object.keys(signal.evidence).length > 0 ? signal.evidence : undefined;
  // The live digest owns the "what filled the state" chips mid-run; once the
  // verdict carries typed evidence, drop the digest's copy of it.
  const digestValues =
    evidence && liveValues ? { ...liveValues, evidence: undefined } : liveValues;
  // The scoped transcript only exists while streaming; on history the row adds
  // nothing beyond what this card already renders (evidence + Data collected),
  // and there's no per-subagent `/history` fetch for council members — so only
  // mount it live, and tell it not to wait on a transcript that never loads.
  const rowHasBody = !!row && busy;

  return (
    <Card className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${meta.name} details`}
        onPress={onDismiss}
        className="flex-row items-center gap-3 active:opacity-70">
        <View className="h-11 w-11 items-center justify-center rounded-pill border-2 border-frosting-200 bg-white dark:border-night-border dark:bg-night-surface">
          <Icon
            name={meta.icon}
            size={24}
            weight="duotone"
            color={dark ? palette.frosting[300] : palette.frosting[600]}
          />
        </View>
        <View className="flex-1">
          <Text variant="heading">{meta.name}</Text>
          <Text variant="muted">{meta.style}</Text>
        </View>
        <View className="items-end gap-1">
          {signal?.signal ? <Badge label={signal.signal} tone={signalTone(signal.signal)} /> : null}
          {typeof signal?.confidence === 'number' ? (
            <Text variant="muted" className="text-xs">
              {Math.round(signal.confidence * 100)}% confident
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View className="gap-1.5">
        {meta.steps.map((s, i) => (
          <StepRow key={s.key} label={s.label} state={states[i]} />
        ))}
      </View>

      {signal?.reasoning ? (
        <View className="gap-1">
          <Text variant="label">Why</Text>
          <Markdown value={signal.reasoning} />
        </View>
      ) : !busy ? (
        <Text variant="muted">No verdict was recorded for {meta.name}.</Text>
      ) : (
        <Text variant="muted">{meta.name} is still deliberating…</Text>
      )}

      {evidence ? (
        <Collapsible title="Evidence" icon="criteria" defaultOpen>
          <StructuredOutput value={evidence} />
        </Collapsible>
      ) : null}

      {/* What this member actually did: its transcript, the tool calls inside it,
          and the sub-agents it ran — read from its own LangGraph namespace when
          the row is expanded, so a 19-member council costs nothing until asked. */}
      {node ? <SubagentTree nodes={[node]} threadId={threadId} /> : null}

      <SubagentStateDigest values={digestValues} />

      {rowHasBody ? <SubgraphDetail row={row!} expectsTranscript={false} /> : null}
    </Card>
  );
}
