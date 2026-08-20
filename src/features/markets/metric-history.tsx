/**
 * The financials a company actually reports, charted.
 *
 * 776,000 rows of `security_metric` existed with nothing reading them. This is the section that
 * makes them visible: pick a metric, pick annual or quarterly, see the series and the periods.
 *
 * THE METRIC LIST COMES FROM THE DATA, NOT THE CATALOGUE. `market.metric` describes what the
 * system can hold; this security may report a third of it. Offering "research & development" for a
 * bank draws an empty chart, which reads as a broken page rather than as a company with no R&D.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Badge, Card, Segmented, Text } from '@/components/ui';
import { TimeSeriesChart } from '@/lib/agent/renderers/chart';

import {
  useAvailableMetrics,
  useMetricSeries,
  type MetricOption,
  type PeriodType,
} from './api/use-security-metrics';
import { formatMoney } from './money';

/** Catalogue order, so the picker reads like a statement rather than an alphabetised dump. */
const CATEGORY_ORDER = ['income_statement', 'cash_flow', 'balance_sheet', 'share'];

function sortOptions(options: MetricOption[]): MetricOption[] {
  return [...options].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
    return a.name.localeCompare(b.name);
  });
}

/**
 * A value, formatted for the unit it is in.
 *
 * `formatMoney` handles the currency and the scale suffix, and withholds the symbol when the
 * currency is unknown — which is the honest render for a yfinance-derived period, since that
 * provider never says what it reported in. A share count is not money and must not get a symbol:
 * 16,400,000,000 shares rendered as "$16.4B" is the same class of mistake as Alibaba's revenue.
 */
function formatValue(value: number, unit: string, currency: string | null): string {
  if (unit === 'shares') {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    return value.toLocaleString('en-US');
  }
  if (unit === 'ratio' || unit === 'percent') return value.toFixed(2);
  return formatMoney(value, currency);
}

export function MetricHistory({ symbol }: { symbol: string }) {
  const [period, setPeriod] = useState<PeriodType>('annual');
  const [metric, setMetric] = useState<string | undefined>(undefined);

  const { options, loading: optionsLoading } = useAvailableMetrics(symbol, period);
  const sorted = useMemo(() => sortOptions(options), [options]);

  // Default to revenue where it exists — it is the line every reader looks at first — and to
  // whatever the company does report otherwise. Chosen at render rather than in an effect so the
  // section never flashes an empty chart before settling.
  const selected =
    (metric && sorted.some((o) => o.code === metric) && metric) ||
    (sorted.some((o) => o.code === 'revenue') ? 'revenue' : sorted[0]?.code);

  const { points, loading: seriesLoading } = useMetricSeries(symbol, selected, period);
  const option = sorted.find((o) => o.code === selected);

  const series = useMemo(() => {
    if (points.length < 2) return null;
    return {
      lines: [
        {
          label: option?.name ?? '',
          points: points.map((p) => ({ x: new Date(p.asOf).getTime(), y: p.value })),
        },
      ],
      startLabel: points[0].asOf,
      endLabel: points[points.length - 1].asOf,
    };
  }, [points, option?.name]);

  // NOTHING AT ALL RENDERS NOTHING. A security the backlogs have not reached yet gets no section
  // rather than an empty frame — the same rule the macro panel and the price chart follow.
  if (optionsLoading) return null;
  if (sorted.length === 0) return null;

  const latest = points.length > 0 ? points[points.length - 1] : null;
  // A DERIVED FIGURE SAYS SO. Free cash flow is reported by one provider and computed for another,
  // and the reader is entitled to know which they are looking at.
  const derived = option?.isDerived && latest?.source === 'derived';

  return (
    <View className="mt-5 gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="heading">Financials</Text>
        <Segmented
          options={[
            { id: 'annual', label: 'Annual' },
            { id: 'quarter', label: 'Quarterly' },
          ]}
          value={period}
          onChange={(v) => setPeriod(v as PeriodType)}
        />
      </View>

      {/* Horizontally scrolled rather than wrapped: the list is 15-25 metrics and a wrapped grid
          would push the chart off the first screen on a phone. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
        <View className="flex-row gap-2 px-1">
          {sorted.map((o) => (
            <Pressable
              key={o.code}
              onPress={() => setMetric(o.code)}
              accessibilityRole="button"
              accessibilityLabel={o.name}
            >
              <Badge label={o.name} tone={o.code === selected ? 'info' : 'neutral'} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Card tone="muted" className="gap-2">
        <View className="flex-row items-baseline justify-between">
          <Text variant="muted">{option?.name ?? ''}</Text>
          {latest ? (
            <View className="flex-row items-baseline gap-2">
              {derived ? <Badge label="computed" tone="neutral" /> : null}
              <Text variant="heading">
                {formatValue(latest.value, option?.unit ?? 'currency', latest.currency)}
              </Text>
            </View>
          ) : null}
        </View>

        {series ? (
          <TimeSeriesChart data={series} />
        ) : (
          <Text variant="muted">
            {seriesLoading ? 'Loading…' : 'Not enough periods to chart.'}
          </Text>
        )}

        {/* The periods themselves, newest first. A chart shows the shape; the numbers are what a
            reader checks against a filing. */}
        {points.length > 0 ? (
          <View className="gap-1">
            {[...points].reverse().slice(0, 6).map((p) => (
              <View key={p.asOf} className="flex-row items-baseline justify-between">
                <Text variant="muted" className="text-xs">
                  {p.asOf}
                </Text>
                <Text variant="body" className="text-xs">
                  {formatValue(p.value, option?.unit ?? 'currency', p.currency)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}
