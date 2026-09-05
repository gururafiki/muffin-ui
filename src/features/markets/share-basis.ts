/**
 * What a segment share is a share OF.
 *
 * PURE, AND IN ITS OWN MODULE FOR THAT REASON — the same split `segment-dimensions.ts`,
 * `segment-label.ts` and `money.ts` use. `segment-breakdown.tsx` imports react-native, which `tsx`
 * cannot transform, so a rule left inside it cannot be driven offline and its defects are visible
 * only on a rendered page. This one was: Chevron's page showed Downstream 77.2%, Upstream 47.9%
 * and All Other 0.3% — summing to 125.4% — under a caption correctly stating that shares are of
 * the $231.37B the filing totals those lines to.
 *
 * THREE BASES, AND THE MIDDLE ONE WAS MISSING.
 *
 *   reconciles   the lines add up to a total the FILER published, which may exceed reported
 *                revenue because segments are disclosed before intersegment eliminations
 *                (Chevron $231.37B against $184.43B; Samsung KRW 363.72T against 333.61T).
 *                The denominator is that filed total — it is not fiction, it is a published
 *                figure, and shares against it sum to 100.
 *   under        the filer disclosed only part of itself — Novo Nordisk covers 37% of revenue by
 *                geography — which is legitimate. Shares are of REVENUE and the gap is named.
 *   over         the lines exceed revenue and reconcile to nothing. The sum is an artifact, so
 *                there is no honest denominator: show figures, withhold every percentage.
 *
 * The old expression had the first case written in its comment and not in its code:
 * `revenue > 0 && !overCovered ? revenue : disclosed` takes REVENUE whenever the split reconciles,
 * because reconciling is exactly what makes `overCovered` false. The caption and the arithmetic
 * then disagreed about the same split.
 */
export interface ShareBasis {
  /** What the percentages are taken against, or null when none is honest. */
  total: number | null;
  /** Which of the three cases applied — the caption is written from this. */
  basis: 'filed' | 'revenue' | 'none';
}

export function shareBasis(args: {
  revenue: number | null;
  disclosed: number;
  filedTotal: number | null;
}): ShareBasis {
  const { revenue, disclosed, filedTotal } = args;
  const reconciles =
    filedTotal !== null && filedTotal > 0 && Math.abs(disclosed - filedTotal) <= filedTotal * 0.01;
  // FIRST, because a filed total the lines add up to beats an inferred one even when it exceeds
  // reported revenue — that excess is the intersegment elimination, not an error.
  if (reconciles) return { total: disclosed, basis: 'filed' };
  if (revenue !== null && revenue > 0 && disclosed > revenue * 1.01) {
    return { total: null, basis: 'none' };
  }
  if (revenue !== null && revenue > 0) return { total: revenue, basis: 'revenue' };
  return { total: disclosed, basis: 'filed' };
}
