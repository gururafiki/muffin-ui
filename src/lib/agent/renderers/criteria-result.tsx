import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';
import { ReportSection, TagRow, toneColor, Verdict, toneForSignal } from './widgets';

type Dict = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

type Criterion = {
  criterion_name?: string;
  signal?: string;
  weight?: number;
  reasoning?: string;
  counterargument?: string;
};

function CriterionRow({ c }: { c: Criterion }) {
  const [open, setOpen] = useState(false);
  const tone = toneForSignal(c.signal);
  const weightPct = typeof c.weight === 'number' ? Math.round(c.weight * 100) : undefined;
  return (
    <View className="gap-1 border-b border-frosting-100 py-2 dark:border-night-border">
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row items-center gap-2 active:opacity-70">
        <View className="h-2.5 w-2.5 rounded-pill" style={{ backgroundColor: toneColor[tone] }} />
        <Text variant="body" className="flex-1 text-sm">{c.criterion_name ?? 'Criterion'}</Text>
        {weightPct != null ? <Text variant="muted" className="text-xs">{weightPct}%</Text> : null}
        {c.signal ? <Badge label={c.signal.replace(/_/g, ' ')} tone={tone} /> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
      </Pressable>
      {open ? (
        <View className="gap-2 pl-4 pt-1">
          {c.reasoning ? <Markdown value={c.reasoning} /> : null}
          {c.counterargument ? (
            <View className="gap-1">
              <Text variant="label">Counterargument</Text>
              <Text variant="muted" className="text-sm">{c.counterargument}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Renderer for the `criteria_analysis` agent: a sector-aware scorecard. Shows
 * the stock's classification, an optional headline synthesis, the weighted
 * criteria (each expandable to its reasoning) and the valuation methodology.
 */
export function CriteriaResult({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <JsonBlock value={value} />;
  const v = value as Dict;
  const cls = (v.classification ?? {}) as Dict;
  const synth = (v.synthesis ?? {}) as Dict;
  const criteria = (v.criterion_evaluations ?? v.merged_criteria ?? []) as Criterion[];
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

      {Array.isArray(criteria) && criteria.length > 0 ? (
        <Card className="gap-0">
          <Text variant="label" className="mb-1">Criteria ({criteria.length})</Text>
          {criteria.map((c, i) => (
            <CriterionRow key={i} c={c} />
          ))}
        </Card>
      ) : null}

      <ReportSection title="Valuation methodology" icon="evaluation" markdown={str(valuation.methodology_summary)} />
      {str(cls.rationale) ? <ReportSection title="Why this classification" icon="criteria" markdown={cls.rationale as string} /> : null}
    </View>
  );
}
