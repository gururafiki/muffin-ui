import { View } from 'react-native';

import { Text } from '@/components/ui';
import {
  DebateView,
  bullBearTurns,
  debatersForTurns,
  namedMessageTurns,
} from '@/features/multi-agent/debate';
import { parseOr, zCriterionEvaluation, zPersonaSignal } from '@/lib/agent/schemas';
import { Markdown } from './markdown';
import { StructuredOutput } from './structured';
import { Verdict } from './widgets';

type Dict = Record<string, unknown>;

/**
 * Renders the **Result** facet of an execution-tree node — the node's
 * structured verdict/output ONLY. Tools, data sources, and nested sub-agent
 * trees are separate facets (Task 3); keeping this to shape-only output
 * dispatch also sidesteps the require cycle `criteria-result.tsx` has with
 * `subagent-tree` (see the renderers barrel's require-cycle note) — hence the
 * lean inline criterion card below instead of reusing `CriterionDetails`.
 *
 * Shape-dispatched (the node `name` is only a weak hint; the payload shape
 * decides): debate → criterion → persona signal → generic `StructuredOutput`.
 */
export function renderNodeOutput(
  node: { name?: string },
  value: unknown,
  _threadId?: string, // reserved (Task 3 passes threadId); unused now
): React.ReactNode {
  if (value == null) return null;

  // Debate shape — a conference message list (investment or risk debate) or
  // the legacy bull/bear string-array lists. Built exactly like trading-result.tsx.
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Dict;
    const turns = Array.isArray(v.investment_debate_messages)
      ? namedMessageTurns(v.investment_debate_messages)
      : Array.isArray(v.risk_debate_messages)
        ? namedMessageTurns(v.risk_debate_messages)
        : bullBearTurns(v.investment_bull_responses, v.investment_bear_responses);
    if (turns.length > 0) {
      return <DebateView title="Debate" debaters={debatersForTurns(turns)} turns={turns} />;
    }
  }

  // Criterion shape — a criteria-analysis worker's evaluation.
  const c = parseOr(zCriterionEvaluation, value, 'exec.criterion');
  if (c && (c.criterion_name || /criter|evaluate/i.test(node.name ?? ''))) {
    return (
      <View className="gap-3">
        <Verdict signal={c.signal} confidence={c.confidence} summary={c.reasoning} />
        {c.counterargument ? (
          <View className="gap-1">
            <Text variant="label">Counterargument</Text>
            <Markdown value={c.counterargument} />
          </View>
        ) : null}
        {c.evidence_summary ? (
          <View className="gap-1">
            <Text variant="label">Evidence</Text>
            <StructuredOutput value={c.evidence_summary} />
          </View>
        ) : null}
        {c.limitations ? (
          <View className="gap-1">
            <Text variant="label">Limitations</Text>
            <StructuredOutput value={c.limitations} />
          </View>
        ) : null}
        {c.sub_criteria ? (
          <View className="gap-1">
            <Text variant="label">Sub-criteria</Text>
            <StructuredOutput value={c.sub_criteria} />
          </View>
        ) : null}
      </View>
    );
  }

  // Persona signal shape — a council member's verdict.
  const p = parseOr(zPersonaSignal, value, 'exec.persona');
  if (p && p.agent_id && p.signal) {
    return (
      <View className="gap-3">
        <Verdict signal={p.signal} confidence={p.confidence} summary={p.reasoning} />
        {p.evidence ? (
          <View className="gap-1">
            <Text variant="label">Evidence</Text>
            <StructuredOutput value={p.evidence} />
          </View>
        ) : null}
      </View>
    );
  }

  // Default — no recognised shape.
  return <StructuredOutput value={value} />;
}
