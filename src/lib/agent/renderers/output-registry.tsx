import { View } from 'react-native';

import { Text } from '@/components/ui';
import {
  DebateView,
  bullBearTurns,
  debatersForTurns,
  namedMessageTurns,
} from '@/features/multi-agent/debate';
import type { OutputKind } from '@/lib/agent/exec-tree';
import { parseOr, zCriterionEvaluation, zPersonaSignal } from '@/lib/agent/schemas';
import { Markdown } from './markdown';
import { StructuredOutput } from './structured';
import { Verdict } from './widgets';

type Dict = Record<string, unknown>;

/**
 * Renders the **Result** facet of an execution-tree node — the node's structured
 * verdict/output ONLY. Tools, data sources and nested sub-agent trees are separate
 * facets. Keeping this to output dispatch also sidesteps the require cycle
 * `criteria-result.tsx` has with the tree (see the renderers barrel's note) — hence
 * the lean inline criterion card instead of reusing `CriterionDetails`.
 *
 * **Dispatch is explicit, not shape-sniffed.** `outputKind` comes from the producer
 * (registry `StageDef.outputKind`, or the node builder). Shape inference is only the
 * fallback for nodes that declare nothing.
 *
 * Why that matters: `zCriterionEvaluation` is a `looseObject` with every field
 * optional, so it accepts *any* dict. Combined with the old `/criter|evaluate/i` test
 * against the node's **display label**, the criteria stage literally named "Define the
 * criteria" parsed as a criterion and rendered an empty card with a "—" verdict,
 * silently dropping the entire `criteria_definition` payload.
 */
export function renderNodeOutput(
  node: { name?: string; outputKind?: OutputKind },
  value: unknown,
  _threadId?: string, // reserved; kept for signature stability with lazy detail
): React.ReactNode {
  if (value == null) return null;

  const kind = node.outputKind;

  if (kind === 'debate' || (!kind && looksLikeDebate(value))) {
    const view = renderDebate(value);
    if (view) return view;
  }

  if (kind === 'criterion' || (!kind && !Array.isArray(value) && hasCriterionShape(value))) {
    const view = renderCriterion(value);
    if (view) return view;
  }

  if (kind === 'persona' || !kind) {
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
  }

  if (kind === 'report' && typeof value === 'string') return <Markdown value={value} />;

  return <StructuredOutput value={value} />;
}

/** A serialized `BaseMessage` as it appears in persisted state. */
function isSerializedMessageList(value: unknown): value is Dict[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((m) => !!m && typeof m === 'object' && ('type' in m || 'role' in m))
  );
}

function looksLikeDebate(value: unknown): boolean {
  if (isSerializedMessageList(value)) return true;
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return false;
  const v = value as Dict;
  return (
    Array.isArray(v.investment_debate_messages) ||
    Array.isArray(v.risk_debate_messages) ||
    Array.isArray(v.investment_bull_responses) ||
    Array.isArray(v.investment_bear_responses)
  );
}

/**
 * Build a `DebateView` from either shape.
 *
 * The bare-array case is the trading_decision bug: `stageOutput` EXTRACTS
 * `values.investment_debate_messages`, so the renderer receives a plain array of
 * serialized BaseMessages — but the old code only checked for a non-array object
 * carrying that key, so every debate fell through to a raw `StructuredOutput` JSON
 * dump. Both the wrapper dict and the extracted array must work.
 */
function renderDebate(value: unknown): React.ReactNode {
  const turns = isSerializedMessageList(value)
    ? namedMessageTurns(value)
    : (() => {
        const v = (value ?? {}) as Dict;
        if (Array.isArray(v.investment_debate_messages)) return namedMessageTurns(v.investment_debate_messages);
        if (Array.isArray(v.risk_debate_messages)) return namedMessageTurns(v.risk_debate_messages);
        return bullBearTurns(v.investment_bull_responses, v.investment_bear_responses);
      })();
  if (turns.length === 0) return null;
  return <DebateView title="Debate" debaters={debatersForTurns(turns)} turns={turns} />;
}

/** A real criterion evaluation carries at least one criterion-specific field —
 * unlike "any dict", which the loose schema alone would accept. */
function hasCriterionShape(value: unknown): boolean {
  if (typeof value !== 'object' || value == null) return false;
  const v = value as Dict;
  return 'criterion_name' in v || ('signal' in v && 'score' in v);
}

function renderCriterion(value: unknown): React.ReactNode {
  // Some workers store it wrapped (`{ evaluation: {...} }`, the raw model output).
  const unwrapped =
    typeof value === 'object' && value && 'evaluation' in value
      ? (value as { evaluation: unknown }).evaluation
      : value;
  const c = parseOr(zCriterionEvaluation, unwrapped, 'exec.criterion');
  if (!c || !hasCriterionShape(unwrapped)) return null;
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
