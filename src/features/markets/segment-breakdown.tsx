/**
 * Business lines — the same split by revenue and by profit, side by side.
 *
 * THE PAIRED DONUTS ARE THE POINT. "Amazon is 18% AWS by revenue and roughly 60% by operating
 * income" is the sentence this section exists to make visible in one glance, and neither donut says
 * it alone. They share a selection, so tapping a line highlights it in both.
 *
 * TWO THINGS THAT ARE RENDERED RATHER THAN HIDDEN, because hiding them would make the chart claim
 * more than the filing does:
 *
 * - **A filer names only material places.** Geography splits run 2–15 entries (median 4) and Amazon
 *   discloses no Canada at all. The note says so; a donut alone implies the world is covered.
 * - **`NonUsMember` is the residual after the named countries**, not all-foreign. Labelled
 *   "Other (rest of world)" for that reason.
 *
 * A NESTED LINE'S SHARE IS OF ITS PARENT. Alphabet tags YouTube inside Google Services, so those
 * children sum to Google Services and never to Alphabet — the expandable says "of <parent>" on
 * every row, because a percentage with an unstated denominator is just a wrong number.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Collapsible, Segmented, Text } from '@/components/ui';
import { chartColors, palette } from '@/theme/colors';

import { Donut } from './charts/donut';
import { formatMoney } from './money';
import type { SegmentKind, SegmentLine } from './api/use-segments';

const KIND_LABEL: Record<SegmentKind, string> = {
  product: 'Products',
  business: 'Segments',
  geography: 'Geography',
};

const pct = (v: number, total: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');

export function SegmentBreakdown({
  kinds,
  kind,
  onKindChange,
  lines,
  currency,
  periodEnding,
  revenue,
}: {
  kinds: SegmentKind[];
  kind: SegmentKind;
  onKindChange: (k: SegmentKind) => void;
  lines: SegmentLine[];
  currency: string | null;
  periodEnding: string | null;
  /** The company's own revenue, to check the split against. Null where it is not held. */
  revenue: number | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (lines.length === 0) return null;

  const withRevenue = lines.filter((l) => l.revenue !== null && l.revenue > 0);
  // A LOSS-MAKING DIVISION HAS NO ANGLE. Segment profit genuinely goes negative, and a donut cannot
  // draw that — so the profit donut is drawn from the profitable lines and the count is stated,
  // rather than silently dropping a division the reader can see in the list below.
  const withProfit = lines.filter((l) => l.operatingIncome !== null && l.operatingIncome > 0);
  const lossMaking = lines.filter((l) => l.operatingIncome !== null && l.operatingIncome < 0);

  const disclosed = withRevenue.reduce((a, l) => a + (l.revenue as number), 0);
  const profitTotal = withProfit.reduce((a, l) => a + (l.operatingIncome as number), 0);

  // THE SAME RULE THE SANKEY USES, BECAUSE THE TWO DESCRIBE THE SAME SPLIT. Measured live on the
  // deployed data: Alphabet's four segments sum to 512.62bn against a revenue of 402.84bn, so the
  // chart correctly drew no streams — while this list happily reported "66.9%" of a total the
  // company never earned. A share is only a share OF something, and when the parts exceed the
  // whole the denominator is fiction.
  //
  // Over the revenue: show the figures, withhold every percentage, say why. Under it: the filer
  // disclosed only part of itself (Novo Nordisk covers 37% by geography), which is legitimate, so
  // shares are taken against REVENUE and the gap is named.
  //
  // UNLESS THE SPLIT ADDS UP TO A FILED TOTAL, in which case the denominator is not fiction — it
  // is a figure the company published, and shares against it are exactly what a reader wants.
  // Samsung's segments sum to KRW 363.72T against a reported 333.61T because the filer discloses
  // them before intersegment eliminations. Same test and same basis as the Sankey above: the two
  // describe one split and must never disagree about whether it can be shown as shares.
  const filedTotal = withRevenue.find((l) => l.filedTotal !== null)?.filedTotal ?? null;
  const reconciles =
    filedTotal !== null && filedTotal > 0 && Math.abs(disclosed - filedTotal) <= filedTotal * 0.01;
  const overCovered =
    revenue !== null && revenue > 0 && disclosed > revenue * 1.01 && !reconciles;
  const revTotal = revenue !== null && revenue > 0 && !overCovered ? revenue : disclosed;
  const undisclosed = revTotal - disclosed;
  const showUndisclosed = !overCovered && undisclosed > revTotal * 0.01;

  const colorOf = (key: string) => {
    const i = withRevenue.findIndex((l) => l.memberCode === key);
    return chartColors.sector[(i < 0 ? 0 : i) % chartColors.sector.length];
  };

  const sel = lines.find((l) => l.memberCode === selected) ?? null;

  return (
    <>
      <View className="mt-5 flex-row items-baseline justify-between">
        <Text variant="label">Business lines</Text>
        {periodEnding ? <Text variant="muted">FY {periodEnding.slice(0, 4)}</Text> : null}
      </View>

      <Card tone="muted" className="mt-2 gap-3">
        {kinds.length > 1 ? (
          <Segmented
            options={kinds.map((k) => ({ id: k, label: KIND_LABEL[k] }))}
            value={kind}
            onChange={(k) => {
              onKindChange(k);
              setSelected(null);
            }}
          />
        ) : null}

        {overCovered ? null : (
        <View className="flex-row flex-wrap items-center justify-center gap-4">
          <View className="items-center gap-1">
            <Donut
              slices={[
                ...withRevenue.map((l) => ({
                  key: l.memberCode,
                  label: l.label,
                  value: l.revenue as number,
                  color: colorOf(l.memberCode),
                })),
                ...(showUndisclosed
                  ? [{ key: '__undisclosed', label: 'Not disclosed', value: undisclosed,
                       color: palette.frosting[200] }]
                  : []),
              ]}
              size={168}
              selectedKey={selected}
              onSelect={setSelected}
              animationKey={kind}
              centerPrimary={sel && sel.revenue ? pct(sel.revenue, revTotal) : 'Revenue'}
              centerSecondary={sel ? 'of revenue' : `${withRevenue.length} lines`}
            />
            <Text variant="muted">Revenue</Text>
          </View>

          {withProfit.length > 0 ? (
            <View className="items-center gap-1">
              <Donut
                slices={withProfit.map((l) => ({
                  key: l.memberCode,
                  label: l.label,
                  value: l.operatingIncome as number,
                  color: colorOf(l.memberCode),
                }))}
                size={168}
                selectedKey={selected}
                onSelect={setSelected}
                animationKey={`${kind}:profit`}
                centerPrimary={
                  sel && sel.operatingIncome && sel.operatingIncome > 0
                    ? pct(sel.operatingIncome, profitTotal)
                    : 'Profit'
                }
                centerSecondary={sel ? 'of operating income' : `${withProfit.length} lines`}
              />
              <Text variant="muted">Operating income</Text>
            </View>
          ) : null}
        </View>
        )}

        {overCovered ? (
          <Text variant="muted" className="text-[11px]">
            These lines add up to more than the company&rsquo;s reported revenue, so they are shown
            as filed figures without a share of the total. Usually the filer disclosed the same
            business more than one way.
          </Text>
        ) : null}

        {/* Drawn against a filed total that is not reported revenue — say which, and by how much. */}
        {!overCovered && reconciles && revenue !== null && revenue > 0
          && disclosed > revenue * 1.01 ? (
          <Text variant="muted" className="text-[11px]">
            Shares are of the {formatMoney(disclosed, currency)} the filing totals these lines to,
            {' '}{Math.round(((disclosed - revenue) / revenue) * 100)}% above reported revenue of
            {' '}{formatMoney(revenue, currency)} — usually segments disclosed before intersegment
            eliminations.
          </Text>
        ) : null}

        {lossMaking.length > 0 ? (
          <Text variant="muted" className="text-[11px]">
            {lossMaking.length === 1
              ? `${lossMaking[0].label} made a loss and is not in the profit ring.`
              : `${lossMaking.length} lines made a loss and are not in the profit ring.`}
          </Text>
        ) : null}

        <View className="gap-1.5">
          {lines.map((l) => {
            const on = selected === null || selected === l.memberCode;
            const row = (
              <View className="flex-row items-center justify-between gap-2">
                <View className="shrink flex-row items-center gap-2">
                  <View
                    style={{ backgroundColor: colorOf(l.memberCode), opacity: on ? 1 : 0.35 }}
                    className="h-2.5 w-2.5 rounded-full"
                  />
                  <Text variant="body" className="shrink">
                    {l.label}
                  </Text>
                </View>
                <Text variant="muted" className="shrink-0">
                  {l.revenue !== null ? formatMoney(l.revenue, l.currency ?? currency) : '—'}
                  {l.revenue !== null && revTotal > 0 && !overCovered
                    ? ` · ${pct(l.revenue, revTotal)}`
                    : ''}
                  {l.marginPct !== null ? ` · ${l.marginPct.toFixed(1)}% margin` : ''}
                </Text>
              </View>
            );

            if (l.children.length === 0) {
              return (
                <Pressable
                  key={l.memberCode}
                  onPress={() => setSelected(selected === l.memberCode ? null : l.memberCode)}
                  style={{ opacity: on ? 1 : 0.5 }}>
                  {row}
                </Pressable>
              );
            }

            return (
              // `Collapsible` renders `title` itself, so `headerRight` carries ONLY the figures —
              // passing the row here too printed every nested line's name twice.
              <Collapsible
                key={l.memberCode}
                title={l.label}
                headerRight={
                  <Text variant="muted" className="shrink-0">
                    {l.revenue !== null ? formatMoney(l.revenue, l.currency ?? currency) : '—'}
                    {l.revenue !== null && revTotal > 0 && !overCovered
                      ? ` · ${pct(l.revenue, revTotal)}`
                      : ''}
                    {l.marginPct !== null ? ` · ${l.marginPct.toFixed(1)}% margin` : ''}
                  </Text>
                }
                depth={0}>
                <View className="gap-1 pl-4">
                  {l.children.map((c) => (
                    <View key={c.memberCode} className="flex-row items-center justify-between gap-2">
                      <Text variant="body" className="shrink">
                        {c.label}
                      </Text>
                      <Text variant="muted" className="shrink-0">
                        {c.revenue !== null ? formatMoney(c.revenue, c.currency ?? currency) : '—'}
                        {c.shareOfParentPct !== null
                          ? ` · ${c.shareOfParentPct.toFixed(1)}% of ${l.label}`
                          : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </Collapsible>
            );
          })}
        </View>

        {showUndisclosed ? (
          <Text variant="muted" className="text-[11px]">
            {formatMoney(undisclosed, currency)} of revenue is not broken out —
            filers disclose only the lines they consider material.
          </Text>
        ) : null}

        {kind === 'geography' ? (
          <Text variant="muted" className="text-[11px]">
            Filers name only material countries, so this is not a full map of where the company
            operates. A &ldquo;rest of world&rdquo; line is the remainder after the named ones.
          </Text>
        ) : null}
      </Card>
    </>
  );
}
