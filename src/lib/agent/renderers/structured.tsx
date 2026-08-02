/**
 * The generic renderer for any structured payload — the layer that decides what an
 * arbitrary agent output *looks* like.
 *
 * ## Why this reads field meaning rather than just types
 *
 * Every payload used to render as a stack of `LABEL` / value rows: a classification, a
 * portfolio decision and a criterion definition all looked like the same database dump,
 * `confidence` printed as the text "0.9", and a null field printed its label with
 * nothing under it. The information was all there and none of it was legible.
 *
 * A Pydantic model's meaning is recoverable from its field names and value shapes, so
 * this picks a presenter per field — a 0..1 `confidence` is a gauge, a `signal` is a
 * toned pill, a `weight` is a share of a whole, `*_pct` is a signed delta, `limitations`
 * is a caveat list, `key_findings` a checklist. Because the rules key on *shape and
 * naming convention* rather than on a model registry, a graph written next month gets
 * the same treatment for free — the same principle the timeline's structure follows.
 *
 * Hand-designed cards (`cards.tsx`) sit on top for the payloads that carry a run's
 * headline, and reuse the same presenters from `fields.tsx`, so the two layers cannot
 * drift into looking like different products.
 */
import { View } from 'react-native';

import { Badge, Text } from '@/components/ui';
import {
  CaveatList,
  CheckList,
  ChipList,
  DeltaValue,
  Gauge,
  MetricRow,
  MoneyValue,
  SignalPill,
  WeightBar,
} from './fields';
import { isMessageArray, MessageList } from './messages';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';
import { toneForSignal } from './widgets';

type Dict = Record<string, unknown>;

// ── Field-meaning rules ──────────────────────────────────────────────────────
// Ordered most-specific first; the first match wins. The names follow conventions
// muffin-agent's schemas already use, but nothing here is tied to a specific graph.

const RE = {
  signal: /^(signal|rating|consensus_rating|action|verdict|stance|decision_action|combined_signal|winning_side)$/,
  ratio: /^(confidence|conviction|weighted_confidence|probability|relevance|combined_confidence)$/,
  weight: /weight$/,
  percent: /(_pct|_percent|percentage)$/,
  money: /^(price_target|entry_price|stop_loss|take_profit|market_cap|price|target_price)$/,
  count: /^(total_articles|bullish_articles|bearish_articles|neutral_articles|holding_days|n)$/,
  /** Things that went wrong or are missing — warnings, not content. */
  caveats:
    /^(limitations|key_risks|key_risks_remaining|risks|missing_information|key_uncertainties|valuation_errors_to_avoid|caveats|pitfalls|errors)$/,
  /** Things established, or to be checked off. */
  checks:
    /^(key_findings|key_catalysts|catalysts|monitoring_checklist|checklist|screening_questions|suggested_followups|data_requirements|evidence_summary)$/,
  /** Short categorical values — a chip, not a sentence. */
  categorical:
    /^(sector|sub_sector|market|market_type|stock_type|task_type|mode|mode_hint|mode_used|source|source_type|benchmark|time_horizon|primary_valuation_method|status|ticker|agent_id|name|criterion_name|title)$/,
  /** Prose always worth full markdown treatment. */
  prose:
    /(rationale|reasoning|summary|thesis|synthesis|narrative|answer_markdown|notes|report|guidance|explanation|counterargument|position_sizing|snippet|content)$/,
  /** Internal plumbing a reader cannot act on. */
  hidden: /^(messages|structured_response|jump_to|__.*__)$/,
};

/** Fields that lead a card; everything else keeps declaration order beneath them.
 * Hierarchy is most of what separates a designed card from a field dump. */
function rank(key: string): number {
  if (RE.signal.test(key)) return 0;
  if (RE.ratio.test(key)) return 1;
  if (RE.categorical.test(key)) return 2;
  if (RE.money.test(key) || RE.percent.test(key)) return 3;
  if (RE.prose.test(key)) return 5;
  if (RE.checks.test(key)) return 6;
  if (RE.caveats.test(key)) return 7;
  return 4;
}

/** Nothing to say — render neither the label nor a blank. The old renderer emitted
 * "SUB SECTOR" with an empty line under it whenever a field was null. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Dict).length === 0;
  return false;
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const isRatio = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const allStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');

/** A bare string is only a signal when it unambiguously reads as one — otherwise a
 * one-word answer would render as a giant pill. */
function looksLikeSignal(value: string): boolean {
  if (value.length > 24) return false;
  return /^(strong[_ ]?)?(buy|sell)$|^(bull|bear)(ish)?$|^hold$|^neutral$|^(strong[_ ]?)?(positive|negative)$/i.test(
    value.trim(),
  );
}

/** One field, as a compact right-aligned row where it has a compact presentation, or a
 * labelled block where it needs the width. */
function Field({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const label = humanize(name);

  if (RE.signal.test(name) && typeof value === 'string') {
    return (
      <MetricRow label={label}>
        <SignalPill signal={value} size="sm" />
      </MetricRow>
    );
  }
  if (RE.ratio.test(name) && isRatio(value)) {
    return (
      <MetricRow label={label}>
        <Gauge value={value} />
      </MetricRow>
    );
  }
  if (RE.weight.test(name) && isRatio(value)) {
    return (
      <MetricRow label={label}>
        <WeightBar value={value} />
      </MetricRow>
    );
  }
  if (RE.percent.test(name) && typeof value === 'number') {
    return (
      <MetricRow label={label}>
        <DeltaValue value={value} />
      </MetricRow>
    );
  }
  if (RE.money.test(name) && typeof value === 'number') {
    return (
      <MetricRow label={label}>
        <MoneyValue value={value} />
      </MetricRow>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <MetricRow label={label}>
        <Badge label={value ? 'yes' : 'no'} tone={value ? 'bullish' : 'neutral'} />
      </MetricRow>
    );
  }
  // 28 chars, not more: `Badge` is `self-start` and never wraps, so a longer value runs
  // off the card. Agents routinely write prose into fields that sound categorical —
  // `time_horizon` came back as a full sentence on a real portfolio decision.
  if (RE.categorical.test(name) && typeof value === 'string' && value.length <= 28) {
    return (
      <MetricRow label={label}>
        <Badge label={value} tone="info" />
      </MetricRow>
    );
  }
  if (typeof value === 'number') {
    return (
      <MetricRow label={label}>
        <Text variant="body" className="text-sm tabular-nums">
          {Number.isInteger(value) ? value : Number(value.toFixed(3))}
        </Text>
      </MetricRow>
    );
  }

  const body = allStrings(value) ? (
    RE.caveats.test(name) ? (
      <CaveatList items={value} />
    ) : RE.checks.test(name) ? (
      <CheckList items={value} />
    ) : (
      <ChipList items={value} />
    )
  ) : typeof value === 'string' ? (
    RE.prose.test(name) || /[\n#`|]|\*\*/.test(value) || value.length > 120 ? (
      <Markdown value={value} />
    ) : (
      <Text variant="body" className="text-sm">
        {value}
      </Text>
    )
  ) : (
    <StructuredOutput value={value} depth={depth + 1} />
  );

  return (
    <View className="gap-1">
      <Text variant="label">{label}</Text>
      {body}
    </View>
  );
}

/**
 * Render an arbitrary structured payload.
 *
 * `depth` guards runaway nesting: past two levels a payload is almost certainly a raw
 * provider blob rather than an agent's considered output, and JSON is the honest way to
 * show that.
 */
export function StructuredOutput({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isEmpty(value)) return null;

  if (isMessageArray(value)) return <MessageList messages={value} />;

  if (typeof value === 'string') {
    if (depth === 0 && looksLikeSignal(value)) return <SignalPill signal={value} />;
    if (/[\n#`|]|\*\*/.test(value) || value.length > 120) return <Markdown value={value} />;
    return (
      <Text variant="body" className="text-sm">
        {value}
      </Text>
    );
  }

  if (typeof value === 'number') {
    return (
      <Text variant="body" className="text-sm tabular-nums">
        {Number.isInteger(value) ? value : Number(value.toFixed(3))}
      </Text>
    );
  }
  if (typeof value === 'boolean') {
    return <Badge label={value ? 'yes' : 'no'} tone={value ? 'bullish' : 'neutral'} />;
  }

  if (Array.isArray(value)) {
    if (allStrings(value)) return <ChipList items={value} />;
    if (depth > 1) return <JsonBlock value={value} />;
    return (
      <View className="gap-2">
        {value.map((v, i) => (
          <View key={i} className="border-l-2 border-frosting-200 pl-2.5 dark:border-night-border">
            <StructuredOutput value={v} depth={depth + 1} />
          </View>
        ))}
      </View>
    );
  }

  if (depth > 2) return <JsonBlock value={value} />;

  const entries = Object.entries(value as Dict)
    .filter(([k, v]) => !RE.hidden.test(k) && !isEmpty(v))
    .sort(([a], [b]) => rank(a) - rank(b));

  if (entries.length === 0) return null;

  return (
    <View className="gap-2">
      {entries.map(([k, v]) => (
        <Field key={k} name={k} value={v} depth={depth} />
      ))}
    </View>
  );
}

export { toneForSignal };
