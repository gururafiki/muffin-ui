/**
 * What a business line OWNS, as the filing states it.
 *
 * PURE, AND IN ITS OWN MODULE FOR THAT REASON — the same split `share-basis.ts`,
 * `segment-dimensions.ts` and `money.ts` use. `segment-breakdown.tsx` imports react-native, which
 * `tsx` cannot transform, so a rule left inside it cannot be driven offline and its defects are
 * visible only on a rendered page.
 *
 * THREE INSTANTS, AND THE FILER CHOOSES WHICH IT DISCLOSES. Segment assets, long-lived assets by
 * geography (which ASC 280 requires beside geographic revenue — Amazon reports US $180bn and
 * non-US $61.3bn) and goodwill per segment are each optional and independent. A filer publishes
 * any subset, so a missing one is a fact about the DISCLOSURE and not about the split.
 *
 * WHICH IS WHY AN ABSENT FIGURE IS OMITTED RATHER THAN DASHED. A row reading
 * `Assets 12.5B · Long-lived — · Goodwill —` invites the reader to think the line is incompletely
 * measured; `Assets 12.5B` alone says exactly what the filing says. Same reason a security with no
 * server row shows no number rather than an authored one.
 */
export interface Holdings {
  assets: number | null;
  longLivedAssets: number | null;
  goodwill: number | null;
}

export interface HoldingPart {
  label: string;
  value: number;
}

/**
 * The parts to render, in filing order — broadest measure first.
 *
 * Returns an EMPTY array when the filer disclosed none, which is the signal to render nothing at
 * all rather than an empty container: a heading with nothing under it is the shape this app's
 * section convention forbids.
 */
export function holdingParts(h: Holdings): HoldingPart[] {
  const out: HoldingPart[] = [];
  if (h.assets !== null && Number.isFinite(h.assets)) {
    out.push({ label: 'Assets', value: h.assets });
  }
  if (h.longLivedAssets !== null && Number.isFinite(h.longLivedAssets)) {
    // "Long-lived" rather than "Non-current": ASC 280's own wording, and the phrase a reader of the
    // filing will have seen.
    out.push({ label: 'Long-lived', value: h.longLivedAssets });
  }
  if (h.goodwill !== null && Number.isFinite(h.goodwill)) {
    out.push({ label: 'Goodwill', value: h.goodwill });
  }
  return out;
}
