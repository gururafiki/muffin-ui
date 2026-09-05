/**
 * Which dimension a filer discloses, and WHICH YEAR EACH ONE IS FOR.
 *
 * PURE, AND IN ITS OWN MODULE FOR THAT REASON — the same split `segment-label.ts` and `money.ts`
 * use. `use-segments.ts` imports react-query and the Supabase client, neither of which `tsx` can
 * transform, so logic left inside it cannot be driven offline and its defects are only visible on
 * a rendered page.
 *
 * A PERIOD BELONGS TO A DIMENSION, NOT TO A COMPANY. `security_segment_current` picks the latest
 * annual period PER AXIS, so a filer that stopped disclosing business segments but kept disclosing
 * geographies carries two different years at once. GE Vernova serves business segments for
 * FY2022 beside geographies for FY2025. The hook used to derive ONE period —
 * `lines.find((l) => l.periodEnding)` over every line of every dimension — and the panel showed it
 * above whichever dimension the reader selected, so switching the tab changed the numbers and not
 * the year. Measured 2026-09-05: of 210 securities disclosing more than one dimension, **66**
 * disagree on the year and the widest gap is **14 years** — a 2011 breakdown captioned FY2025.
 */
export interface DimensionedLine {
  kind: string;
  axis: string;
  periodEnding: string | null;
}

/**
 * Groups lines by dimension, choosing the RICHEST axis within each, and reports that axis's own
 * period. A filer can tag one dimension on several axes (`srt:ProductOrServiceAxis` and
 * `us-gaap:StatementBusinessSegmentsAxis` both carry products for some filers); the axis with the
 * most members is the fullest disclosure, and the period must come from THAT axis rather than from
 * whichever line happened to sort first.
 */
export function groupByDimension<T extends DimensionedLine>(
  lines: T[],
  kinds: readonly string[],
): { byKind: Map<string, T[]>; periodByKind: Map<string, string | null> } {
  const byKind = new Map<string, T[]>();
  const periodByKind = new Map<string, string | null>();
  for (const kind of kinds) {
    const ofKind = lines.filter((l) => l.kind === kind);
    if (ofKind.length === 0) continue;
    const axes = [...new Set(ofKind.map((l) => l.axis))];
    const richest = axes
      .map((axis) => ofKind.filter((l) => l.axis === axis))
      .sort((a, b) => b.length - a.length)[0];
    byKind.set(kind, richest);
    periodByKind.set(kind, richest.find((l) => l.periodEnding)?.periodEnding ?? null);
  }
  return { byKind, periodByKind };
}
