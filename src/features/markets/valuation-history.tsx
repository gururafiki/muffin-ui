/**
 * What the market has paid for this company over time.
 *
 * `market.security_ratio_series` computes P/E, P/S, P/B, price/FCF, the two yields and the
 * margin/return ratios PER PRICE BAR — the architecture financecharts uses, where the page exposes
 * `ADJ close` and `DILUTED EPS TTM` and divides. Nothing in the app read that view until this
 * section.
 *
 * WHY THE CURRENT-VS-AVERAGE LINE IS THE POINT. A P/E of 37 means nothing on its own; a P/E of 37
 * against a five-year average of 28 is a statement. That comparison is a pure function of the
 * series, so it is computed here and never stored — storing it would mean a row that goes stale
 * every time a bar lands.
 *
 * WHY AN EMPTY CHART CAN BE THE HONEST ANSWER. Where a filer reports in one currency and trades in
 * another, the view withholds every price-based ratio rather than dividing dollars by kroner and
 * producing a number that is wrong by the exchange rate and looks completely ordinary. This section
 * says so in words. "No P/E because we will not guess at an exchange rate" and "no P/E because we
 * have no earnings for this company" are different facts, and a blank chart states neither.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Badge, Card, Segmented, Text } from '@/components/ui';
import { TimeSeriesChart } from '@/lib/agent/renderers/chart';

import {
  RATIO_OPTIONS,
  RATIO_RANGES,
  useRatioSeries,
  type RatioOption,
  type RatioRange,
} from './api/use-ratio-series';

const RANGES = Object.keys(RATIO_RANGES) as RatioRange[];

/** A multiple reads as `37.5x`, a yield as `2.7%`. Formatting per field, never one shared helper. */
function formatRatio(value: number, option: RatioOption): string {
  return option.unit === 'percent' ? `${value.toFixed(2)}%` : `${value.toFixed(1)}x`;
}

export function ValuationHistory({ symbol }: { symbol: string | undefined }) {
  const [ratio, setRatio] = useState(RATIO_OPTIONS[0].code);
  const [range, setRange] = useState<RatioRange>('5Y');

  const option = RATIO_OPTIONS.find((o) => o.code === ratio) ?? RATIO_OPTIONS[0];
  const { points, loading, currencyComparable, reportCurrency, quoteCurrency, empty } =
    useRatioSeries(symbol, ratio, range);

  // A bar with no value is a bar the ratio is withheld for — a loss-making quarter, or a period
  // before the first filing. It must not be charted as a gap of zero.
  const valued = useMemo(() => points.filter((p) => p.value !== null), [points]);

  const series = useMemo(() => {
    if (valued.length < 2) return null;
    return {
      lines: [
        {
          label: option.name,
          points: valued.map((p) => ({ x: new Date(p.date).getTime(), y: p.value as number })),
        },
      ],
      startLabel: valued[0].date,
      endLabel: valued[valued.length - 1].date,
    };
  }, [valued, option.name]);

  const stats = useMemo(() => {
    if (valued.length === 0) return null;
    const values = valued.map((p) => p.value as number);
    const current = values[values.length - 1];
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    // Guard the division: an average of zero is possible for a margin that hovers around break-even.
    const deltaPct = average !== 0 ? ((current - average) / Math.abs(average)) * 100 : null;
    return { current, average, deltaPct };
  }, [valued]);

  // NOTHING AT ALL RENDERS NOTHING — a security the backlogs have not reached yet gets no section
  // rather than an empty frame, the same rule the macro panel and metric history follow.
  if (loading) return null;
  if (empty) return null;

  // The currency gate applies only to the ratios that involve a price. Net margin, ROE and ROA are
  // filing-over-filing and are populated for exactly the securities whose P/E is withheld, so the
  // section stays useful rather than disappearing.
  const withheld = option.needsPrice && !currencyComparable;

  return (
    <>
      <View className="mt-5 flex-row items-center justify-between">
        <Text variant="label">Valuation</Text>
        <Segmented
          options={RANGES.map((r) => ({ id: r, label: r }))}
          value={range}
          onChange={setRange}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
        <View className="flex-row gap-1.5">
          {RATIO_OPTIONS.map((o) => (
            <Pressable
              key={o.code}
              onPress={() => setRatio(o.code)}
              accessibilityRole="button"
              accessibilityLabel={o.name}
            >
              <Badge label={o.name} tone={o.code === ratio ? 'info' : 'neutral'} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Card tone="muted" className="mt-2 gap-2">
        {withheld ? (
          <Text variant="muted">
            {`No ${option.name}: this company reports in ${reportCurrency ?? 'another currency'} and trades in ${quoteCurrency ?? 'a different one'}. Dividing one by the other would give a number that looks ordinary and is wrong by the exchange rate.`}
          </Text>
        ) : series ? (
          <>
            {stats ? (
              <View className="flex-row items-baseline justify-between">
                <Text variant="body">{formatRatio(stats.current, option)}</Text>
                <Text variant="muted">
                  {`${range} avg ${formatRatio(stats.average, option)}`}
                  {stats.deltaPct !== null
                    ? ` · ${stats.deltaPct >= 0 ? '+' : ''}${stats.deltaPct.toFixed(0)}%`
                    : ''}
                </Text>
              </View>
            ) : null}
            <TimeSeriesChart data={series} />
          </>
        ) : (
          <Text variant="muted">
            {`Not enough history to chart ${option.name} over ${range}.`}
          </Text>
        )}
      </Card>
    </>
  );
}
