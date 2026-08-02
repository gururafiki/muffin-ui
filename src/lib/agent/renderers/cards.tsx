/**
 * Hand-designed cards for the payloads that carry a run's headline.
 *
 * The semantic baseline (`structured.tsx`) already renders every agent output legibly.
 * These go further for the handful a reader actually opens a run to see — a portfolio
 * decision, a council verdict, a scorecard — giving them hierarchy and a shape you can
 * recognise at a glance instead of a uniform stack of rows.
 *
 * ## The contract every card here honours
 *
 * **Return `null` when the payload does not match.** `renderNodeOutput` falls through to
 * the next candidate and finally to the semantic baseline, so a backend schema change
 * degrades to a plainer rendering rather than to a blank card or a crash. That is why
 * each card guards on the fields it actually depends on rather than trusting its channel
 * name — the channel says what a payload *is*, not that it is well-formed.
 *
 * Everything is built from `fields.tsx` presenters and `widgets.tsx`, so a card and the
 * baseline beneath it read as the same product.
 */
import { View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Collapsible, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import {
  CaveatList,
  CheckList,
  ChipList,
  DeltaValue,
  Gauge,
  HeadlineStat,
  MetricRow,
  MoneyValue,
  SignalPill,
  WeightBar,
} from './fields';
import { Markdown } from './markdown';
import { StructuredOutput } from './structured';
import { ConfidenceBar, toneColor, toneForSignal } from './widgets';

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const dictList = (v: unknown): Dict[] => (Array.isArray(v) ? v.filter(isDict) : []);

/** A card's title strip: an icon, a name, and an optional right-hand slot. */
function CardHead({ icon, title, subtitle, right }: { icon: Parameters<typeof Icon>[0]['name']; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="h-8 w-8 items-center justify-center rounded-pill bg-frosting-100 dark:bg-night-surface-muted">
        <Icon name={icon} size={16} color={palette.frosting[500]} />
      </View>
      <View className="min-w-0 flex-1">
        <Text variant="heading" className="text-base">{title}</Text>
        {subtitle ? <Text variant="muted" className="text-xs">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** A titled block, used inside cards for the prose/list sections. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text variant="label">{title}</Text>
      {children}
    </View>
  );
}

/**
 * A short value as a pill, a long one as its own wrapping block.
 *
 * `Badge` is `self-start` with no wrapping, so a sentence-length value pushes straight
 * off the card — which is exactly what `time_horizon` did ("0-3 months — anchored to the
 * Jul 30 Q2 print (binary event); 30-day post-print monitoring window…") on the
 * portfolio decision. Agents write prose into fields that sound categorical, so any
 * card-level badge has to assume that.
 */
function TagField({ label, value }: { label: string; value: string }) {
  if (value.length <= 28) {
    return (
      <MetricRow label={label}>
        <Badge label={value} tone="info" />
      </MetricRow>
    );
  }
  return (
    <Section title={label}>
      <Text variant="body" className="text-sm">
        {value}
      </Text>
    </Section>
  );
}

// ── Criteria analysis ────────────────────────────────────────────────────────

/** `classification` — what the ticker IS, which every downstream stage filters on. */
export function ClassificationCard({ value }: { value: unknown }) {
  if (!isDict(value)) return null;
  const ticker = str(value.ticker);
  const sector = str(value.sector);
  if (!ticker && !sector) return null;
  const confidence = num(value.confidence);
  const preSupplied = confidence === 1 && /pre-supplied/i.test(str(value.rationale) ?? '');

  return (
    <Card tone="muted" className="gap-3">
      <CardHead
        icon="globe"
        title={ticker ?? 'Classification'}
        subtitle={str(value.primary_valuation_method)}
        right={confidence != null ? <Gauge value={confidence} /> : undefined}
      />
      <ChipList
        items={[sector, str(value.sub_sector), str(value.market) ?? str(value.market_type), str(value.stock_type)].filter(
          (s): s is string => !!s,
        )}
      />
      {preSupplied ? (
        <Text variant="muted" className="text-xs">
          Supplied with the run — no classification agent ran for this field.
        </Text>
      ) : str(value.rationale) ? (
        <Markdown value={str(value.rationale) as string} />
      ) : null}
      {strList(value.limitations).length > 0 ? (
        <Section title="Limitations">
          <CaveatList items={strList(value.limitations)} />
        </Section>
      ) : null}
      {dictList(value.data_sources).length > 0 ? <DataSources sources={dictList(value.data_sources)} /> : null}
    </Card>
  );
}

function DataSources({ sources }: { sources: Dict[] }) {
  const lines = sources
    .map((s) => [str(s.subagent), str(s.data_retrieved), str(s.period) ? `(${str(s.period)})` : undefined].filter(Boolean).join(' — '))
    .filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <Collapsible title="Data sources" icon="research" meta={`${lines.length}`}>
      <ChipList items={lines} />
    </Collapsible>
  );
}

/** One criterion definition — the unit of a scorecard, before anything scores it. */
function CriterionDefRow({ c }: { c: Dict }) {
  const name = str(c.name) ?? str(c.criterion_name);
  if (!name) return null;
  const weight = num(c.weight);
  const guidance = str(c.assessment_guidance);
  const reqs = strList(c.data_requirements);
  const body = guidance || reqs.length > 0;

  const header = (
    <View className="flex-row items-center gap-2">
      <Text variant="body" className="min-w-0 flex-1 text-sm">{name}</Text>
      {str(c.target_range) ? <Badge label={str(c.target_range) as string} tone="info" /> : null}
      {weight != null ? <WeightBar value={weight} /> : null}
    </View>
  );

  if (!body) return <View className="py-1.5">{header}</View>;
  return (
    <Collapsible title={name} icon="criteria" meta={str(c.target_range)}>
      <View className="gap-2">
        {weight != null ? <MetricRow label="Weight of scorecard"><WeightBar value={weight} /></MetricRow> : null}
        {guidance ? <Markdown value={guidance} /> : null}
        {reqs.length > 0 ? (
          <Section title="Data required">
            <CheckList items={reqs} />
          </Section>
        ) : null}
        {str(c.source) ? <MetricRow label="Source"><Badge label={str(c.source) as string} tone="info" /></MetricRow> : null}
      </View>
    </Collapsible>
  );
}

/** `criteria_definition` (a full stage output) and `merged_criteria` (a bare list). */
export function CriteriaDefinitionCard({ value }: { value: unknown }) {
  const list = Array.isArray(value) ? dictList(value) : isDict(value) ? dictList(value.criteria) : [];
  const wrapper = isDict(value) && !Array.isArray(value) ? value : undefined;
  if (list.length === 0) return null;
  const totalWeight = list.reduce((sum, c) => sum + (num(c.weight) ?? 0), 0);

  return (
    <Card tone="muted" className="gap-3">
      <CardHead
        icon="criteria"
        title={wrapper ? (str(wrapper.ticker) ?? 'Criteria') : 'Criteria'}
        subtitle={`${list.length} criteria${totalWeight > 0 ? ` · weights sum to ${Math.round(totalWeight * 100)}%` : ''}`}
        right={num(wrapper?.confidence) != null ? <Gauge value={num(wrapper?.confidence) as number} /> : undefined}
      />
      {wrapper ? (
        <ChipList
          items={[str(wrapper.sector), str(wrapper.market_type), str(wrapper.stock_type), str(wrapper.primary_valuation_method)].filter(
            (s): s is string => !!s,
          )}
        />
      ) : null}
      {wrapper && str(wrapper.classification_rationale) ? <Markdown value={str(wrapper.classification_rationale) as string} /> : null}
      <View>
        {list.map((c, i) => (
          <CriterionDefRow key={i} c={c} />
        ))}
      </View>
      {wrapper && strList(wrapper.screening_questions).length > 0 ? (
        <Section title="Screening questions">
          <CheckList items={strList(wrapper.screening_questions)} />
        </Section>
      ) : null}
      {wrapper && strList(wrapper.valuation_errors_to_avoid).length > 0 ? (
        <Section title="Pitfalls to avoid">
          <CaveatList items={strList(wrapper.valuation_errors_to_avoid)} />
        </Section>
      ) : null}
      {wrapper && strList(wrapper.limitations).length > 0 ? (
        <Section title="Limitations">
          <CaveatList items={strList(wrapper.limitations)} />
        </Section>
      ) : null}
    </Card>
  );
}

/** `valuation_methodology` — the approach, plus criteria the skills would have missed. */
export function MethodologyCard({ value }: { value: unknown }) {
  if (!isDict(value)) return null;
  const summary = str(value.methodology_summary);
  const extra = dictList(value.additional_criteria);
  if (!summary && extra.length === 0) return null;

  return (
    <Card tone="muted" className="gap-3">
      <CardHead icon="trading" title="Valuation methodology" subtitle={str(value.ticker)} />
      {summary ? <Markdown value={summary} /> : null}
      {extra.length > 0 ? (
        <Section title={`Additional criteria (${extra.length})`}>
          <View>
            {extra.map((c, i) => (
              <CriterionDefRow key={i} c={c} />
            ))}
          </View>
        </Section>
      ) : null}
      {strList(value.limitations).length > 0 ? (
        <Section title="Limitations">
          <CaveatList items={strList(value.limitations)} />
        </Section>
      ) : null}
      {dictList(value.sources).length > 0 ? <DataSources sources={dictList(value.sources)} /> : null}
    </Card>
  );
}

/** `synthesis` — the scorecard's verdict plus the weight × score table behind it. */
export function SynthesisCard({ value }: { value: unknown }) {
  if (!isDict(value)) return null;
  const signal = str(value.signal);
  const composite = num(value.composite_score);
  if (!signal && composite == null) return null;
  const rows = dictList(value.weighted_breakdown);
  const tone = toneForSignal(signal);

  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-end gap-4">
        {signal ? <SignalPill signal={signal} size="lg" /> : null}
        {composite != null ? (
          // `composite_score` is documented 0.0–1.0, so it renders as a percentage —
          // printing `Math.round(x * 100)` bare turned 0.075 into "8", which reads like
          // 8 out of 10 rather than 7.5%. A graph emitting a >1 score keeps its own units.
          <HeadlineStat
            value={composite <= 1 ? `${Math.round(composite * 100)}%` : String(Number(composite.toFixed(2)))}
            caption="composite score"
            tone={tone}
          />
        ) : null}
        <View className="flex-1" />
      </View>
      {num(value.confidence) != null ? <ConfidenceBar value={num(value.confidence) as number} tone={tone} /> : null}
      {str(value.thesis_paragraph) ? <Markdown value={str(value.thesis_paragraph) as string} /> : null}
      {strList(value.key_positives).length > 0 ? (
        <Section title="Key positives">
          <CheckList items={strList(value.key_positives)} />
        </Section>
      ) : null}
      {strList(value.key_negatives).length > 0 ? (
        <Section title="Key negatives">
          <CaveatList items={strList(value.key_negatives)} icon="close" tone={palette.bearish} />
        </Section>
      ) : null}
      {strList(value.divergences).length > 0 ? (
        <Section title="Divergences">
          <CaveatList items={strList(value.divergences)} />
        </Section>
      ) : null}
      {rows.length > 0 ? (
        <Collapsible title="Weighted breakdown" icon="criteria" meta={`${rows.length} criteria`}>
          <View className="gap-1.5 pt-1">
            {rows.map((r, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <Text variant="body" className="min-w-0 flex-1 text-sm">{str(r.name) ?? `Criterion ${i + 1}`}</Text>
                {str(r.source) ? <Badge label={str(r.source) as string} tone="info" /> : null}
                {num(r.weight) != null ? <WeightBar value={num(r.weight) as number} /> : null}
                {num(r.contribution) != null ? (
                  <Text variant="muted" className="w-12 text-right text-xs tabular-nums">
                    {(num(r.contribution) as number).toFixed(2)}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </Collapsible>
      ) : null}
    </Card>
  );
}

// ── Trading decision ─────────────────────────────────────────────────────────

/** `portfolio_decision` — the run's final artifact, read as a decision ticket. */
export function DecisionTicketCard({ value }: { value: unknown }) {
  if (!isDict(value)) return null;
  const rating = str(value.rating);
  if (!rating) return null;
  const tone = toneForSignal(rating);

  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center gap-3">
        <SignalPill signal={rating} size="lg" />
        <View className="flex-1">
          {num(value.confidence) != null ? <ConfidenceBar value={num(value.confidence) as number} tone={tone} /> : null}
        </View>
      </View>
      {str(value.executive_summary) ? <Markdown value={str(value.executive_summary) as string} /> : null}
      <View className="gap-1">
        {num(value.price_target) != null ? <MetricRow label="Price target"><MoneyValue value={num(value.price_target) as number} /></MetricRow> : null}
        {num(value.stop_loss) != null ? <MetricRow label="Stop"><MoneyValue value={num(value.stop_loss) as number} /></MetricRow> : null}
        {str(value.time_horizon) ? <TagField label="Horizon" value={str(value.time_horizon) as string} /> : null}
      </View>
      {str(value.position_sizing) ? (
        <Section title="Position sizing">
          <Text variant="body" className="text-sm">{str(value.position_sizing)}</Text>
        </Section>
      ) : null}
      {str(value.investment_thesis) ? (
        <Collapsible title="Investment thesis" icon="thinking">
          <Markdown value={str(value.investment_thesis) as string} />
        </Collapsible>
      ) : null}
      {strList(value.key_risks_remaining).length > 0 ? (
        <Section title="Risks accepted">
          <CaveatList items={strList(value.key_risks_remaining)} />
        </Section>
      ) : null}
      {value.incorporates_past_lessons === true ? (
        <View className="flex-row items-center gap-2">
          <Icon name="check-circle" size={14} color={palette.leaf[500]} weight="fill" />
          <Text variant="muted" className="text-xs">Informed by past decisions on this ticker.</Text>
        </View>
      ) : null}
    </Card>
  );
}

/** `investment_judge` — who won the bull/bear debate, and on what. */
export function JudgeCard({ value }: { value: unknown }) {
  if (!isDict(value)) return null;
  const signal = str(value.signal);
  if (!signal) return null;
  const tone = toneForSignal(signal);
  const winner = str(value.winning_side);

  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center gap-3">
        <SignalPill signal={signal} />
        {winner ? <Badge label={`${winner} case won`} tone={winner === 'bull' ? 'bullish' : winner === 'bear' ? 'bearish' : 'neutral'} /> : null}
        <View className="flex-1" />
        {num(value.conviction) != null ? <Gauge value={num(value.conviction) as number} tone={tone} /> : null}
      </View>
      {str(value.summary) ? <Markdown value={str(value.summary) as string} /> : null}
      {str(value.bull_case) ? (
        <Section title="Bull case">
          <Markdown value={str(value.bull_case) as string} />
        </Section>
      ) : null}
      {str(value.bear_case) ? (
        <Section title="Bear case">
          <Markdown value={str(value.bear_case) as string} />
        </Section>
      ) : null}
      {strList(value.key_catalysts).length > 0 ? (
        <Section title="Catalysts">
          <CheckList items={strList(value.key_catalysts)} />
        </Section>
      ) : null}
      {strList(value.key_risks).length > 0 ? (
        <Section title="Risks">
          <CaveatList items={strList(value.key_risks)} />
        </Section>
      ) : null}
      {strList(value.monitoring_checklist).length > 0 ? (
        <Collapsible title="What to monitor" icon="criteria" meta={`${strList(value.monitoring_checklist).length}`}>
          <CheckList items={strList(value.monitoring_checklist)} />
        </Collapsible>
      ) : null}
    </Card>
  );
}

/** `trader` — the operational levels, as a plan you could hand to a desk. */
export function TradePlanCard({ value }: { value: unknown }) {
  if (!isDict(value)) return null;
  const action = str(value.action);
  if (!action) return null;
  const levels: [string, number | undefined][] = [
    ['Entry', num(value.entry_price)],
    ['Stop', num(value.stop_loss)],
    ['Take profit', num(value.take_profit)],
  ];
  const hasLevels = levels.some(([, v]) => v != null);

  return (
    <Card tone="muted" className="gap-3">
      <SignalPill signal={action} />
      {str(value.time_horizon) ? <TagField label="Horizon" value={str(value.time_horizon) as string} /> : null}
      {hasLevels ? (
        <View className="flex-row gap-6">
          {levels.map(([label, v]) =>
            v != null ? <HeadlineStat key={label} value={String(v)} caption={label} /> : null,
          )}
        </View>
      ) : (
        <Text variant="muted" className="text-xs">No levels set — a hold means no change, not a small position.</Text>
      )}
      {str(value.position_sizing) ? (
        <Section title="Sizing">
          <Text variant="body" className="text-sm">{str(value.position_sizing)}</Text>
        </Section>
      ) : null}
      {str(value.reasoning) ? <Markdown value={str(value.reasoning) as string} /> : null}
    </Card>
  );
}

/** `resolved_decisions` — how past calls on this ticker actually turned out. */
export function OutcomesCard({ value }: { value: unknown }) {
  const rows = dictList(value);
  if (rows.length === 0) return null;

  return (
    <Card tone="muted" className="gap-2">
      <CardHead icon="portfolio" title="Past decisions resolved" subtitle={`${rows.length} scored against benchmark`} />
      {rows.map((r, i) => {
        const outcome = isDict(r.outcome) ? r.outcome : {};
        const raw = num(outcome.raw_return_pct);
        const alpha = num(outcome.alpha_return_pct);
        return (
          <View key={i} className="gap-1 border-t border-frosting-100 pt-2 dark:border-night-border">
            <View className="flex-row items-center gap-2">
              <Text variant="body" className="text-sm font-heading">{str(r.ticker) ?? '—'}</Text>
              {str(r.date) ? <Text variant="muted" className="text-xs">{str(r.date)}</Text> : null}
              {str(outcome.decision_action) ? <Badge label={str(outcome.decision_action) as string} tone={toneForSignal(str(outcome.decision_action))} /> : null}
              <View className="flex-1" />
              {raw != null ? <DeltaValue value={raw} /> : null}
            </View>
            <View className="flex-row gap-4">
              {alpha != null ? (
                <MetricRow label={`vs ${str(outcome.benchmark) ?? 'benchmark'}`}>
                  <DeltaValue value={alpha} />
                </MetricRow>
              ) : null}
              {num(outcome.holding_days) != null ? (
                <MetricRow label="Held">
                  <Text variant="body" className="text-sm tabular-nums">{num(outcome.holding_days)}d</Text>
                </MetricRow>
              ) : null}
            </View>
            {str(r.reflection) ? <Markdown value={str(r.reflection) as string} /> : null}
          </View>
        );
      })}
    </Card>
  );
}

// ── Council ──────────────────────────────────────────────────────────────────

/** `council_synthesis` — the consensus, and how divided the room was. */
export function CouncilVerdictCard({ value }: { value: unknown }) {
  if (!isDict(value)) return null;
  const rating = str(value.consensus_rating);
  if (!rating) return null;
  const tone = toneForSignal(rating);
  const votes = isDict(value.vote_breakdown) ? value.vote_breakdown : undefined;

  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center gap-3">
        <SignalPill signal={rating} size="lg" />
        <View className="flex-1">
          {num(value.weighted_confidence) != null ? (
            <ConfidenceBar value={num(value.weighted_confidence) as number} label="Weighted confidence" tone={tone} />
          ) : null}
        </View>
      </View>
      {votes ? <VoteBreakdown votes={votes} /> : null}
      {str(value.reasoning) ? <Markdown value={str(value.reasoning) as string} /> : null}
      {str(value.bull_case_synthesis) ? (
        <Section title="Bull case">
          <Markdown value={str(value.bull_case_synthesis) as string} />
        </Section>
      ) : null}
      {str(value.bear_case_synthesis) ? (
        <Section title="Bear case">
          <Markdown value={str(value.bear_case_synthesis) as string} />
        </Section>
      ) : null}
      {str(value.dissent_summary) ? (
        <Section title="Dissent">
          <Markdown value={str(value.dissent_summary) as string} />
        </Section>
      ) : null}
      {strList(value.key_uncertainties).length > 0 ? (
        <Section title="Key uncertainties">
          <CaveatList items={strList(value.key_uncertainties)} />
        </Section>
      ) : null}
    </Card>
  );
}

/** Who voted which way — a proportional bar plus the names behind each side. */
function VoteBreakdown({ votes }: { votes: Dict }) {
  const groups = Object.entries(votes)
    .map(([k, v]) => ({ label: k, names: strList(v) }))
    .filter((g) => g.names.length > 0);
  const total = groups.reduce((n, g) => n + g.names.length, 0);
  if (total === 0) return null;

  return (
    <View className="gap-1.5">
      <View className="h-2.5 flex-row overflow-hidden rounded-pill">
        {groups.map((g) => (
          <View
            key={g.label}
            style={{ flex: g.names.length, backgroundColor: toneColor[toneForSignal(g.label)] }}
          />
        ))}
      </View>
      <View className="gap-1">
        {groups.map((g) => (
          <View key={g.label} className="flex-row items-start gap-2">
            <View
              className="mt-1.5 h-2 w-2 rounded-pill"
              style={{ backgroundColor: toneColor[toneForSignal(g.label)] }}
            />
            <Text variant="muted" className="w-24 text-xs">
              {g.label.replace(/_/g, ' ')} · {g.names.length}
            </Text>
            <Text variant="muted" className="min-w-0 flex-1 text-xs">
              {g.names.map((n) => n.replace(/_/g, ' ')).join(', ')}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A specialist's evidence — nested dicts whose leaves are `{signal, confidence, …}`
 * strategy results. Rendered as a grid of small verdict tiles instead of three levels of
 * JSON, which is what the council's `technicals` / `sentiment` members produced.
 */
function strategyTiles(value: unknown): [string, Dict][] {
  if (!isDict(value)) return [];
  return Object.entries(value).filter(
    ([, v]) => isDict(v) && (typeof v.signal === 'string' || typeof v.confidence === 'number'),
  ) as [string, Dict][];
}

/** Worth a grid only when there are at least two comparable strategies to compare. */
export function isStrategyGrid(value: unknown): boolean {
  return strategyTiles(value).length >= 2;
}

export function StrategyGridCard({ value }: { value: unknown }) {
  const tiles = strategyTiles(value);
  if (tiles.length < 2 || !isDict(value)) return null;
  const rest = Object.fromEntries(Object.entries(value).filter(([k]) => !tiles.some(([t]) => t === k)));

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {tiles.map(([name, t]) => {
          const signal = str(t.signal);
          const tone = toneForSignal(signal);
          return (
            <View
              key={name}
              className="min-w-[46%] flex-1 gap-1 rounded-crumb border border-frosting-100 p-2.5 dark:border-night-border">
              <Text variant="muted" className="text-[11px] uppercase tracking-wide">
                {name.replace(/_/g, ' ')}
              </Text>
              {signal ? (
                <Text className="font-heading text-sm" style={{ color: toneColor[tone] }}>
                  {signal.replace(/_/g, ' ')}
                </Text>
              ) : null}
              {num(t.confidence) != null ? <Gauge value={num(t.confidence) as number} tone={tone} width={44} /> : null}
              {isDict(t.metrics) && Object.keys(t.metrics).length > 0 ? (
                <Collapsible title="Metrics" meta={`${Object.keys(t.metrics).length}`}>
                  <StructuredOutput value={t.metrics} depth={1} />
                </Collapsible>
              ) : null}
            </View>
          );
        })}
      </View>
      {Object.keys(rest).length > 0 ? <StructuredOutput value={rest} depth={1} /> : null}
    </View>
  );
}

// ── Research ─────────────────────────────────────────────────────────────────

/** `evidence` / `reranked_evidence` — the sources a research run actually read. */
export function EvidenceCard({ value }: { value: unknown }) {
  const rows = dictList(value);
  if (rows.length === 0 || !rows.some((r) => str(r.url) || str(r.title))) return null;

  return (
    <Card tone="muted" className="gap-2">
      <CardHead icon="research" title="Evidence" subtitle={`${rows.length} source${rows.length === 1 ? '' : 's'}`} />
      {rows.map((r, i) => (
        <View key={i} className="gap-1 border-t border-frosting-100 pt-2 dark:border-night-border">
          <View className="flex-row items-center gap-2">
            <Text variant="body" className="min-w-0 flex-1 text-sm font-heading" numberOfLines={2}>
              {str(r.title) ?? str(r.url) ?? `Source ${i + 1}`}
            </Text>
            {str(r.source_type) ? <Badge label={str(r.source_type) as string} tone="info" /> : null}
            {num(r.relevance) != null ? <Gauge value={num(r.relevance) as number} width={40} /> : null}
          </View>
          {str(r.snippet) ? (
            <Text variant="muted" className="text-xs" numberOfLines={3}>
              {str(r.snippet)}
            </Text>
          ) : null}
          {str(r.url) ? (
            <Text variant="muted" className="text-[11px] text-frosting-500" numberOfLines={1}>
              {str(r.url)}
            </Text>
          ) : null}
        </View>
      ))}
    </Card>
  );
}
