/**
 * "Where the money goes" — the income statement drawn as a flow.
 *
 * DEGRADES BY DESIGN, and that is the reason this section is worth building at all. Measured across
 * the universe: 8,949 equities hold the statement metrics and 66 additionally disclose revenue
 * streams, so the streams column appears for a handful and the waterfall for nearly everyone. A
 * section that rendered only for the 66 would be 0.5% of stock pages.
 *
 * The streams come from whichever dimension the reader has selected in the breakdown below, so the
 * two sections agree — a Sankey showing products while the list below shows geographies would read
 * as two different companies.
 */
import { useState } from 'react';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';

import { Card, Text } from '@/components/ui';

import { useIncomeFlow } from './api/use-income-flow';
import { IncomeSankey } from './charts/sankey';
import { streamsInto } from './income-flow';
import { formatMoney } from './money';
import type { SegmentLine } from './api/use-segments';

export function IncomeFlowSection({
  securityId,
  streams,
}: {
  securityId: string | null | undefined;
  /** The selected dimension's lines, where the filer discloses any. */
  streams?: SegmentLine[];
}) {
  const { nodes, links, currency, periodEnding, loading, empty } = useIncomeFlow(securityId);
  // MEASURED, BUT NEVER BLOCKING ON THE MEASUREMENT. Gating the chart on `onLayout` alone means a
  // callback that does not fire leaves a card with a heading and nothing in it, forever — which is
  // what a browser showed. The window gives a usable width on the first render and `onLayout`
  // refines it to the card's real one.
  const { width: windowWidth } = useWindowDimensions();
  const [measured, setMeasured] = useState(0);
  const width = measured > 0 ? measured : Math.max(280, Math.min(windowWidth, 900) - 64);

  // No statements means no waterfall and therefore no section — the page's convention, since an
  // empty card reads as broken rather than as absent.
  if (loading || empty) return null;

  // THE STREAMS MUST BE THE FLAT SPLIT ONLY. A nested member reconciles to its PARENT, so mixing
  // the two would feed the trunk a number larger than the company's own revenue.
  //
  // AND THEY ARE CHECKED AGAINST THE TRUNK, not taken on trust. A split that exceeds the company's
  // own revenue is drawn against ITS OWN filed total instead — Samsung's segments sum to KRW
  // 363.72T against a reported 333.61T because the filer discloses them before intersegment
  // eliminations, and refusing to draw that loses a correct disclosure. `streamsInto` only does so
  // when the members actually add up to what the filing accepted them against; otherwise the sum
  // is an artifact and it still draws nothing. The pipeline has been wrong in both directions: a
  // serving view that unioned periods put Apple at 143% of its revenue, and 9 of 18 served splits
  // carry a reconciliation target belonging to a different metric entirely.
  const trunk = nodes.find((n) => n.key === 'revenue')?.value ?? null;
  const flat = (streams ?? []).filter((l) => l.revenue !== null && l.revenue > 0);
  // The filed total is a property of the SPLIT, not of a member — every member of one carries the
  // same value, so the first is the split's.
  const filedTotal = flat.find((l) => l.filedTotal !== null)?.filedTotal ?? null;
  const joined = streamsInto(
    flat.map((l) => ({ label: l.label, revenue: l.revenue })), trunk, filedTotal,
  );

  const allNodes = [...joined.nodes, ...nodes];
  const allLinks = [...joined.links, ...links];
  const height = Math.max(260, Math.min(420, allNodes.length * 26));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - measured) > 1) setMeasured(w);
  };

  return (
    <>
      <View className="mt-5 flex-row items-baseline justify-between">
        <Text variant="label">Where the money goes</Text>
        {periodEnding ? <Text variant="muted">FY {periodEnding.slice(0, 4)}</Text> : null}
      </View>
      <Card tone="muted" className="mt-2" onLayout={onLayout}>
        <IncomeSankey
          nodes={allNodes}
          links={allLinks}
          currency={currency}
          width={width}
          height={height}
          animationKey={`${securityId ?? ''}:${flat.length}`}
        />
        {/*
          THE TRUNK IS NOT ALWAYS REPORTED REVENUE, AND THE CHART MUST SAY SO.
          When a split is drawn against its own filed total, every ribbon is still exactly
          proportional — but to a DIFFERENT figure from the one the statement above reports, and a
          reader comparing the two would otherwise see an unexplained gap. Naming the basis and the
          size of the gap is what makes the diagram honest rather than merely drawable.
        */}
        {joined.basis === 'disclosed' && trunk ? (
          <Text variant="muted" className="mt-2">
            Segments are drawn against the {formatMoney(joined.disclosed, currency)} the filing
            totals them to — {Math.round(((joined.disclosed - trunk) / trunk) * 100)}% above
            reported revenue of {formatMoney(trunk, currency)}, which usually means the filer
            discloses segments before intersegment eliminations.
          </Text>
        ) : null}
      </Card>
    </>
  );
}
