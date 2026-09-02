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
import { View, type LayoutChangeEvent } from 'react-native';

import { Card, Text } from '@/components/ui';

import { useIncomeFlow } from './api/use-income-flow';
import { IncomeSankey } from './charts/sankey';
import { streamsInto } from './income-flow';
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
  const [width, setWidth] = useState(0);

  // No statements means no waterfall and therefore no section — the page's convention, since an
  // empty card reads as broken rather than as absent.
  if (loading || empty) return null;

  // THE STREAMS MUST BE THE FLAT SPLIT ONLY. A nested member reconciles to its PARENT, so mixing
  // the two would feed the trunk a number larger than the company's own revenue.
  //
  // AND THEY ARE CHECKED AGAINST THE TRUNK, not taken on trust — `streamsInto` draws nothing when a
  // split exceeds the company's own revenue, and names the remainder when it falls short. The
  // pipeline has been wrong in both directions: a serving view that unioned periods put Apple at
  // 143% of its revenue, and 32 splits still carry a wrong reconciliation target from the parser.
  const trunk = nodes.find((n) => n.key === 'revenue')?.value ?? null;
  const flat = (streams ?? []).filter((l) => l.revenue !== null && l.revenue > 0);
  const joined = streamsInto(flat.map((l) => ({ label: l.label, revenue: l.revenue })), trunk);

  const allNodes = [...joined.nodes, ...nodes];
  const allLinks = [...joined.links, ...links];
  const height = Math.max(260, Math.min(420, allNodes.length * 26));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <>
      <View className="mt-5 flex-row items-baseline justify-between">
        <Text variant="label">Where the money goes</Text>
        {periodEnding ? <Text variant="muted">FY {periodEnding.slice(0, 4)}</Text> : null}
      </View>
      <Card tone="muted" className="mt-2" onLayout={onLayout}>
        {width > 0 ? (
          <IncomeSankey
            nodes={allNodes}
            links={allLinks}
            currency={currency}
            width={width}
            height={height}
            animationKey={`${securityId ?? ''}:${flat.length}`}
          />
        ) : null}
      </Card>
    </>
  );
}
