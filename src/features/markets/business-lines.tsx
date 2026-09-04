/**
 * The two segment sections, composed so they cannot disagree.
 *
 * THE SELECTED DIMENSION LIVES HERE, not in either section. The Sankey's left column and the
 * breakdown's donuts are the SAME split drawn twice, so a reader who switches to Geography must see
 * geographies in both — two independent `useState` calls would drift apart the moment a tab is
 * tapped, and the diagram would silently show products while the list below showed countries.
 *
 * Both sections render independently of each other's data: the waterfall appears for any filer with
 * statements (8,949 of them), the breakdown only where segments are disclosed (66). Neither blocks
 * the other.
 */
import { useState } from 'react';

import { useIncomeFlow } from './api/use-income-flow';
import { useSegments, type SegmentKind } from './api/use-segments';
import { IncomeFlowSection } from './income-flow-section';
import { SegmentBreakdown } from './segment-breakdown';

export function BusinessLines({ securityId }: { securityId: string | null | undefined }) {
  const { kinds, byKind, currency, periodEnding, loading, empty } = useSegments(securityId);
  // THE COMPANY'S OWN REVENUE, so the breakdown can check the split the way the chart does. This is
  // the SAME query `IncomeFlowSection` runs — identical queryKey, so React Query serves it from
  // cache and no second request is made.
  const { nodes } = useIncomeFlow(securityId);
  const revenue = nodes.find((n) => n.key === 'revenue')?.value ?? null;
  const [chosen, setChosen] = useState<SegmentKind | null>(null);

  // Falls back to the first disclosed dimension rather than storing it, so a security whose
  // segments arrive after first render does not sit on a stale null.
  const kind = chosen && kinds.includes(chosen) ? chosen : (kinds[0] ?? null);
  const lines = kind ? (byKind.get(kind) ?? []) : [];

  return (
    <>
      <IncomeFlowSection securityId={securityId} streams={lines} />
      {!loading && !empty && kind ? (
        <SegmentBreakdown
          kinds={kinds}
          kind={kind}
          onKindChange={setChosen}
          lines={lines}
          currency={currency}
          periodEnding={periodEnding}
          revenue={revenue}
        />
      ) : null}
    </>
  );
}
