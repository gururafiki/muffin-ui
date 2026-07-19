import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Chip, Collapsible, Text } from '@/components/ui';
// Type-only import — a runtime import of Conversation here would create a
// require cycle (renderers barrel → this file → conversation → barrel), so the
// nested-transcript rendering is injected by the caller via `renderTranscript`.
import type { SubagentRun } from '@/features/agent-shared/conversation-turns';
import { parseArray, zCriterionEvaluation, type CriterionEvaluation } from '@/lib/agent/schemas';
import { palette } from '@/theme/colors';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';
import { ToolRunList } from './tool-runs';
import { ConfidenceBar, ReportSection, ScoreBar, TagRow, toneColor, Verdict, toneForSignal } from './widgets';

type Dict = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

/** One scorecard row — the schema-validated worker evaluation. */
export type Criterion = CriterionEvaluation;

/**
 * The evaluation collected no live data — either the backend truthing pass
 * says so (`data_collected: false`, criteria runs after 2026-07), or, for
 * older threads, there is no evidence of collection at all.
 */
const noLiveData = (c: Criterion): boolean =>
  c.data_collected === false ||
  (c.data_collected === undefined && !(c.data_sources?.length || c.tool_runs?.length));

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : [];

/**
 * Format backend `DataSource` entries (`{subagent, data_retrieved, period}`)
 * as readable lines instead of raw-JSON chips. Plain strings pass through;
 * unknown dict shapes fall back to their JSON.
 */
const asSourceLines = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object') {
        const d = x as Record<string, unknown>;
        const subagent = typeof d.subagent === 'string' ? d.subagent : undefined;
        const retrieved = typeof d.data_retrieved === 'string' ? d.data_retrieved : undefined;
        const period = typeof d.period === 'string' && d.period.trim() ? ` (${d.period})` : '';
        if (subagent || retrieved) {
          return [subagent, retrieved].filter(Boolean).join(' — ') + period;
        }
        return JSON.stringify(x);
      }
      return '';
    })
    .filter(Boolean);
};

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text variant="label">{label}</Text>
      {children}
    </View>
  );
}

/**
 * The full evaluation body of one criterion: evidence first, sources,
 * sub-criteria, limitations, counterargument — the model's raw reasoning is
 * deliberately last and folded (it's frequently boilerplate). Shared between
 * the scorecard rows and the sub-agents panel's worker detail.
 */
export function CriterionDetails({
  c,
  transcript,
  renderTranscript,
}: {
  c: Criterion;
  transcript?: SubagentRun;
  renderTranscript?: (run: SubagentRun) => React.ReactNode;
}) {
  const tone = toneForSignal(c.signal);
  const evidence = asStrings(c.evidence_summary);
  const sources = asSourceLines(c.data_sources);
  const limitations = asStrings(c.limitations);

  return (
        <View className="gap-3 pl-4 pt-2">
          {noLiveData(c) ? (
            <View className="flex-row items-center gap-2">
              <Icon name="thinking" size={14} color={palette.butter[600]} />
              <Text variant="muted" className="flex-1 text-xs">
                No live data was collected for this criterion — the score reflects model prior
                knowledge only. Treat the cited figures with caution.
              </Text>
            </View>
          ) : null}

          {typeof c.confidence === 'number' && c.confidence >= 0 ? (
            <ConfidenceBar value={c.confidence} tone={tone} />
          ) : null}

          {evidence.length > 0 ? (
            <DetailBlock label="Evidence">
              <View className="gap-1">
                {evidence.map((e, i) => (
                  <View key={i} className="flex-row gap-2">
                    <Icon name="check" size={13} color={palette.leaf[500]} weight="bold" />
                    <Text variant="body" className="flex-1 text-sm">{e}</Text>
                  </View>
                ))}
              </View>
            </DetailBlock>
          ) : null}

          {c.sub_criteria?.length ? (
            <DetailBlock label="Sub-criteria">
              <View className="gap-1.5">
                {c.sub_criteria.map((s, i) => {
                  const st = toneForSignal(s.signal);
                  return (
                    <View key={i} className="flex-row items-center gap-2 border-l-2 border-frosting-100 pl-2 dark:border-night-border">
                      <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: toneColor[st] }} />
                      <Text variant="body" className="flex-1 text-sm">{s.name ?? s.criterion_name ?? `Sub ${i + 1}`}</Text>
                      {s.signal ? <Badge label={s.signal.replace(/_/g, ' ')} tone={st} /> : null}
                    </View>
                  );
                })}
              </View>
            </DetailBlock>
          ) : null}

          {sources.length > 0 ? (
            <DetailBlock label="Data sources">
              {/* Short tags read best as chips; formatted `subagent — data
                  (period)` lines read best as a list. */}
              {sources.every((s) => s.length <= 28) ? (
                <View className="flex-row flex-wrap gap-1.5">
                  {sources.map((s, i) => (
                    <Chip key={i} label={s} />
                  ))}
                </View>
              ) : (
                <View className="gap-1">
                  {sources.map((s, i) => (
                    <View key={i} className="flex-row gap-2">
                      <Icon name="tools" size={13} color={palette.frosting[400]} />
                      <Text variant="muted" className="flex-1 text-sm">{s}</Text>
                    </View>
                  ))}
                </View>
              )}
            </DetailBlock>
          ) : null}

          {limitations.length > 0 ? (
            <DetailBlock label="Limitations">
              <View className="gap-1">
                {limitations.map((l, i) => (
                  <Text key={i} variant="muted" className="text-sm">• {l}</Text>
                ))}
              </View>
            </DetailBlock>
          ) : null}

          {str(c.counterargument) && !/^none\b/i.test(c.counterargument!.trim()) ? (
            <DetailBlock label="Counterargument">
              <Text variant="muted" className="text-sm">{c.counterargument}</Text>
            </DetailBlock>
          ) : null}

          {c.tool_runs?.length ? (
            <Collapsible
              title="Data collection"
              icon="tools"
              meta={`${c.tool_runs.length} tool call${c.tool_runs.length === 1 ? '' : 's'}`}
            >
              <ToolRunList runs={c.tool_runs} />
            </Collapsible>
          ) : null}

          {transcript?.messages?.length && renderTranscript ? (
            <Collapsible title="How this was evaluated" icon="agents">
              {renderTranscript(transcript)}
            </Collapsible>
          ) : null}

          {str(c.reasoning) ? (
            <Collapsible title="Raw reasoning" icon="thinking">
              <Markdown value={c.reasoning!} />
            </Collapsible>
          ) : null}
        </View>
  );
}

/** One criterion, expandable to its full evaluation (`CriterionDetails`). */
function CriterionRow({
  c,
  transcript,
  renderTranscript,
}: {
  c: Criterion;
  transcript?: SubagentRun;
  renderTranscript?: (run: SubagentRun) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tone = toneForSignal(c.signal);
  const weightPct = typeof c.weight === 'number' ? Math.round(c.weight * 100) : undefined;
  const validScore = typeof c.score === 'number' && c.score >= 0;

  return (
    <View className="gap-1 border-b border-frosting-100 py-2 dark:border-night-border">
      <Pressable onPress={() => setOpen((o) => !o)} className="gap-1.5 active:opacity-70">
        <View className="flex-row items-center gap-2">
          <View className="h-2.5 w-2.5 rounded-pill" style={{ backgroundColor: toneColor[tone] }} />
          <Text variant="body" className="flex-1 text-sm">{c.criterion_name ?? 'Criterion'}</Text>
          {noLiveData(c) ? <Badge label="no live data" tone="neutral" /> : null}
          {weightPct != null ? <Text variant="muted" className="text-xs">{weightPct}%</Text> : null}
          {c.signal ? <Badge label={c.signal.replace(/_/g, ' ')} tone={tone} /> : null}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
        </View>
        {validScore ? (
          <View className="pl-4 pr-8">
            <ScoreBar value={c.score as number} max={10} signal={c.signal} />
          </View>
        ) : null}
      </Pressable>

      {open ? <CriterionDetails c={c} transcript={transcript} renderTranscript={renderTranscript} /> : null}
    </View>
  );
}

/** Match a criterion to its evaluation sub-agent run (by name/description). */
function transcriptFor(name: string | undefined, runs: SubagentRun[] | undefined): SubagentRun | undefined {
  if (!name || !runs?.length) return undefined;
  const n = name.trim().toLowerCase();
  return runs.find(
    (r) =>
      r.name?.toLowerCase().includes('criterion') &&
      (r.name?.toLowerCase().includes(n) ||
        r.description?.toLowerCase().includes(n) ||
        (r.messages ?? []).some(
          (m) => typeof m.content === 'string' && (m.content as string).toLowerCase().includes(n),
        )),
  );
}

/**
 * Renderer for the `criteria_analysis` agent: a sector-aware scorecard. The
 * classification tags + verdict lead; every criterion opens into its full
 * evaluation (evidence → sources → sub-criteria → limitations → counterargument,
 * with the raw model reasoning folded at the bottom).
 */
export function CriteriaResult({
  value,
  subagentRuns,
  renderTranscript,
}: {
  value: unknown;
  subagentRuns?: SubagentRun[];
  renderTranscript?: (run: SubagentRun) => React.ReactNode;
}) {
  if (!value || typeof value !== 'object') return <JsonBlock value={value} />;
  const v = value as Dict;
  const cls = (v.classification ?? {}) as Dict;
  const synth = (v.synthesis ?? {}) as Dict;
  const criteria = parseArray(
    zCriterionEvaluation,
    v.criterion_evaluations ?? v.merged_criteria,
    'criterion_evaluations',
  );
  const valuation = (v.valuation_methodology ?? {}) as Dict;

  return (
    <View className="gap-3">
      <TagRow tags={[str(cls.stock_type), str(cls.sector), str(cls.sub_sector), str(cls.market)]} />

      {str(synth.signal) || typeof synth.composite_score === 'number' ? (
        <Verdict
          signal={str(synth.signal)}
          confidence={typeof synth.confidence === 'number' ? synth.confidence : undefined}
          summary={str(synth.summary) ?? str(synth.thesis)}
        />
      ) : null}

      {criteria.length > 0 ? (
        <Card className="gap-0">
          <Text variant="label" className="mb-1">Criteria ({criteria.length})</Text>
          {criteria.map((c, i) => (
            <CriterionRow
              key={i}
              c={c}
              transcript={transcriptFor(c.criterion_name, subagentRuns)}
              renderTranscript={renderTranscript}
            />
          ))}
        </Card>
      ) : null}

      <ReportSection title="Valuation methodology" icon="evaluation" markdown={str(valuation.methodology_summary)} />
      {str(cls.rationale) ? <ReportSection title="Why this classification" icon="criteria" markdown={cls.rationale as string} /> : null}
    </View>
  );
}
