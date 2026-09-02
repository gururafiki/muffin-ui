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
import { chartColors } from '@/theme/colors';

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
}: {
  kinds: SegmentKind[];
  kind: SegmentKind;
  onKindChange: (k: SegmentKind) => void;
  lines: SegmentLine[];
  currency: string | null;
  periodEnding: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (lines.length === 0) return null;

  const withRevenue = lines.filter((l) => l.revenue !== null && l.revenue > 0);
  // A LOSS-MAKING DIVISION HAS NO ANGLE. Segment profit genuinely goes negative, and a donut cannot
  // draw that — so the profit donut is drawn from the profitable lines and the count is stated,
  // rather than silently dropping a division the reader can see in the list below.
  const withProfit = lines.filter((l) => l.operatingIncome !== null && l.operatingIncome > 0);
  const lossMaking = lines.filter((l) => l.operatingIncome !== null && l.operatingIncome < 0);

  const revTotal = withRevenue.reduce((a, l) => a + (l.revenue as number), 0);
  const profitTotal = withProfit.reduce((a, l) => a + (l.operatingIncome as number), 0);

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

        <View className="flex-row flex-wrap items-center justify-center gap-4">
          <View className="items-center gap-1">
            <Donut
              slices={withRevenue.map((l) => ({
                key: l.memberCode,
                label: l.label,
                value: l.revenue as number,
                color: colorOf(l.memberCode),
              }))}
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
                  {l.revenue !== null && revTotal > 0 ? ` · ${pct(l.revenue, revTotal)}` : ''}
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
              <Collapsible key={l.memberCode} title={l.label} headerRight={row} depth={0}>
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
