import { View } from 'react-native';

import { Text } from '@/components/ui';
import {
  DebateView,
  bullBearTurns,
  debatersForTurns,
  namedMessageTurns,
} from '@/features/multi-agent/debate';
import { parseOr, zCriterionEvaluation, zPersonaSignal } from '@/lib/agent/schemas';
import { taskWrite } from '@/lib/agent/run-history';
import { Markdown } from './markdown';
import { StructuredOutput } from './structured';
import { Verdict } from './widgets';

type Dict = Record<string, unknown>;

/**
 * Renders the **Output** facet of a timeline node — its structured verdict/result ONLY.
 * Input, plan, transcript and sub-steps are separate facets. Keeping this to output
 * dispatch also sidesteps the require cycle `criteria-result.tsx` has with the timeline
 * (see the renderers barrel's note) — hence the lean inline criterion card instead of
 * reusing `CriterionDetails`.
 *
 * ## Dispatch is on the STATE CHANNEL, not on the payload's shape
 *
 * A LangGraph task's `result` is a map of the channels it wrote, so the channel name is
 * available from the API for free and is exactly as specific as the payload it names:
 * `criterion_evaluations` is always a criterion evaluation. That makes custom rendering
 * data-driven — a graph reusing a known channel gets the good card, and an unknown
 * channel from a graph written next month falls through to `StructuredOutput` rather
 * than being mis-rendered.
 *
 * This replaced a producer-declared `outputKind` on each registry stage, which was
 * per-graph custom logic of exactly the kind the timeline is meant to do without.
 *
 * Shape sniffing is NOT the fallback, and that is deliberate. `zCriterionEvaluation` is
 * a `looseObject` with every field optional, so it accepts *any* dict; combined with a
 * `/criter|evaluate/i` test against the node's **display label**, the stage literally
 * named "Define the criteria" once parsed as a criterion and rendered an empty card with
 * a "—" verdict, silently dropping the entire `criteria_definition` payload. Only a
 * strict discriminator (`hasCriterionShape`) is allowed to promote an unnamed payload.
 */
const CHANNEL_RENDERERS: Record<string, (value: unknown) => React.ReactNode> = {
  criterion_evaluations: renderCriterion,
  criterion_evaluation: renderCriterion,
  persona_signals: renderPersona,
  investment_debate_messages: renderDebate,
  risk_debate_messages: renderDebate,
};

/** Whether a channel name has a bespoke renderer — used to pick one out of a
 * multi-channel task result. */
export function hasChannelRenderer(channel: string | undefined): boolean {
  return !!channel && channel in CHANNEL_RENDERERS;
}

export function renderNodeOutput(channel: string | undefined, value: unknown): React.ReactNode {
  if (value == null) return null;

  // 1. The declared channel, when we have a renderer for it.
  if (hasChannelRenderer(channel)) {
    const view = CHANNEL_RENDERERS[channel as string](taskWrite(value, channel as string) ?? value);
    if (view) return view;
  }

  // 2. A task that wrote several channels has no single "output" — pick the one we can
  //    render well, if any. (`merge_criteria` writes `merged_criteria` alone; the
  //    criteria workers write `criterion_evaluations` alongside bookkeeping keys.)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value as Dict)) {
      if (!hasChannelRenderer(key)) continue;
      const view = CHANNEL_RENDERERS[key](taskWrite(value, key));
      if (view) return view;
    }
  }

  // 3. Unwrap a single-channel write so the payload — not the envelope — is rendered.
  const unwrapped = channel ? (taskWrite(value, channel) ?? value) : value;

  // 4. Generic shapes, in order of how confidently they identify themselves.
  if (typeof unwrapped === 'string') return <Markdown value={unwrapped} />;
  if (isSerializedMessageList(unwrapped)) {
    const view = renderDebate(unwrapped);
    if (view) return view;
  }
  if (hasCriterionShape(unwrapped)) {
    const view = renderCriterion(unwrapped);
    if (view) return view;
  }
  const persona = parseOr(zPersonaSignal, unwrapped, 'exec.persona');
  if (persona?.agent_id && persona.signal) return renderPersona(unwrapped);

  return <StructuredOutput value={unwrapped} />;
}

/** A serialized `BaseMessage` as it appears in persisted state. */
function isSerializedMessageList(value: unknown): value is Dict[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((m) => !!m && typeof m === 'object' && ('type' in m || 'role' in m))
  );
}

/**
 * Build a `DebateView` from either shape.
 *
 * The bare-array case is the trading_decision bug: the debate channels hold a plain
 * array of serialized BaseMessages, but the old code only checked for a non-array object
 * carrying that key, so every debate fell through to a raw `StructuredOutput` JSON dump.
 * Both the wrapper dict and the extracted array must work.
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

/** A real criterion evaluation carries at least one criterion-specific field — unlike
 * "any dict", which the loose schema alone would accept. */
function hasCriterionShape(value: unknown): boolean {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return false;
  const v = value as Dict;
  return 'criterion_name' in v || ('signal' in v && 'score' in v);
}

function renderPersona(value: unknown): React.ReactNode {
  const p = parseOr(zPersonaSignal, value, 'exec.persona');
  if (!p?.signal) return null;
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
