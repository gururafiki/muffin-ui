/**
 * A company's disclosed business lines — what it actually earns from, and where.
 *
 * THE PARTS SUM TO THE WHOLE, AND THAT IS A GUARANTEE RATHER THAN A HOPE. A split is only stored
 * once the parser has reconciled it against the filing's own undimensioned total for the same
 * concept and period, kept as `security_segment.reconciled_to`. So the lines here can be drawn as
 * flowing into the company's revenue without the client checking anything.
 *
 * THREE THINGS THIS MUST NOT DO, each because the schema went to some trouble to make them
 * expressible and getting them wrong reads as a plausible number:
 *
 *   * NEVER SUM ACROSS AXES. A filer can disclose the same company three ways at once — Amazon's
 *     FY2025 `ProductOrService` split, its `BusinessSegments` split and a coarse Product/Service
 *     split each total 716,924,000,000, and AWS appears under two of them. Summing an axis doubles
 *     the revenue and summing the table triples it, silently and in the right units. Every read
 *     here is filtered to ONE axis, chosen by the caller through the dimension tabs.
 *   * NEVER MIX NESTED WITH FLAT. `security_segment_current` serves only top-level members
 *     (`parent_member is null`); the nested ones live in `security_segment_detail` and their share
 *     is OF THE PARENT. Alphabet's YouTube sums into Google Services, never into Alphabet.
 *   * NEVER ASSUME A CURRENCY. TSMC reports TWD and Novo Nordisk DKK; `currency_code` travels with
 *     every figure and `formatMoney` renders it unlabelled when the data does not say.
 *
 * Keyed on `security_id`, never a symbol — a symbol is not a stable key here, and the display
 * symbol is a different question from the fetch key.
 */
import { useQuery } from '@tanstack/react-query';
import { groupByDimension } from '../segment-dimensions';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { memberLabel } from '@/features/markets/segment-label';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

/** What a filer is splitting itself BY. `geography` is resolved per member, not per axis. */
export type SegmentKind = 'product' | 'business' | 'geography';

// PostgREST v14 sends `numeric` as a JSON number; `coerce` guards a driver that quotes it, which
// would otherwise make `parseArray` drop every row and the section silently vanish.
const zLine = z.looseObject({
  axis: z.string(),
  kind: z.string(),
  member_code: z.string(),
  member_label: z.string().nullish(),
  concept_name: z.string().nullish(),
  reconciled_to: z.coerce.number().nullish(),
  revenue: z.coerce.number().nullish(),
  operating_income: z.coerce.number().nullish(),
  capital_expenditure: z.coerce.number().nullish(),
  depreciation: z.coerce.number().nullish(),
  total_assets: z.coerce.number().nullish(),
  operating_margin_pct: z.coerce.number().nullish(),
  revenue_share_pct: z.coerce.number().nullish(),
  currency_code: z.string().nullish(),
  period_ending: z.string().nullish(),
});

const zNested = z.looseObject({
  parent_axis: z.string().nullish(),
  parent_member: z.string(),
  member_code: z.string(),
  concept_name: z.string().nullish(),
  revenue: z.coerce.number().nullish(),
  operating_income: z.coerce.number().nullish(),
  share_of_parent_pct: z.coerce.number().nullish(),
  currency_code: z.string().nullish(),
});

export interface SegmentLine {
  axis: string;
  kind: SegmentKind;
  /** The filer's own code — `amzn:AmazonWebServicesMember`. Never shown; it is the join key. */
  memberCode: string;
  /** What to call it: the shared concept, else the published label, else the code tidied up. */
  label: string;
  /**
   * The consolidated figure the FILING accepted this split against. Same for every member of a
   * split. A consumer uses it to tell a split that adds up to a real filed total from one whose
   * sum is an artifact — the difference between a gross-basis disclosure worth drawing and a
   * double count that must not be.
   */
  filedTotal: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  capex: number | null;
  depreciation: number | null;
  assets: number | null;
  marginPct: number | null;
  sharePct: number | null;
  currency: string | null;
  periodEnding: string | null;
  /** Present only where the filer nests a further split inside this line. */
  children: NestedLine[];
}

export interface NestedLine {
  memberCode: string;
  label: string;
  revenue: number | null;
  operatingIncome: number | null;
  /** OF THE PARENT. These sum to the line above, never to the company. */
  shareOfParentPct: number | null;
  currency: string | null;
}

const KINDS: SegmentKind[] = ['product', 'business', 'geography'];
const isKind = (k: string): k is SegmentKind => (KINDS as string[]).includes(k);

export function useSegments(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'segments', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();

      // TWO READS, NOT A JOIN. The flat split and the nested cells are separate views precisely so
      // a caller cannot accidentally sum them together; keeping them separate here preserves that.
      const flat = await supabase
        .schema('market')
        .from('security_segment_current')
        .select(
          'axis,kind,member_code,member_label,concept_name,revenue,operating_income,reconciled_to,' +
            'capital_expenditure,depreciation,total_assets,operating_margin_pct,' +
            'revenue_share_pct,currency_code,period_ending',
        )
        .eq('security_id', securityId as string)
        .order('revenue', { ascending: false, nullsFirst: false });
      if (flat.error) {
        throw new Error(`market.security_segment_current read failed: ${flat.error.message}`);
      }

      const nested = await supabase
        .schema('market')
        .from('security_segment_detail')
        .select(
          'parent_axis,parent_member,member_code,concept_name,revenue,operating_income,' +
            'share_of_parent_pct,currency_code',
        )
        .eq('security_id', securityId as string)
        .order('revenue', { ascending: false, nullsFirst: false });
      if (nested.error) {
        throw new Error(`market.security_segment_detail read failed: ${nested.error.message}`);
      }

      return {
        flat: parseArray(zLine, flat.data ?? [], 'security_segment_current'),
        nested: parseArray(zNested, nested.data ?? [], 'security_segment_detail'),
      };
    },
    enabled: !!securityId,
    // A filing is immutable and the parser re-reads only when its own version is bumped, so this
    // changes on the scale of a quarter.
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const nestedByParent = new Map<string, NestedLine[]>();
  for (const n of query.data?.nested ?? []) {
    const child: NestedLine = {
      memberCode: n.member_code,
      label: n.concept_name ?? memberLabel(n.member_code),
      revenue: n.revenue ?? null,
      operatingIncome: n.operating_income ?? null,
      shareOfParentPct: n.share_of_parent_pct ?? null,
      currency: n.currency_code ?? null,
    };
    const key = n.parent_member;
    nestedByParent.set(key, [...(nestedByParent.get(key) ?? []), child]);
  }

  const lines: SegmentLine[] = (query.data?.flat ?? [])
    .filter((r) => isKind(r.kind))
    .map((r) => ({
      axis: r.axis,
      kind: r.kind as SegmentKind,
      memberCode: r.member_code,
      filedTotal: r.reconciled_to ?? null,
      label: r.concept_name ?? r.member_label ?? memberLabel(r.member_code),
      revenue: r.revenue ?? null,
      operatingIncome: r.operating_income ?? null,
      capex: r.capital_expenditure ?? null,
      depreciation: r.depreciation ?? null,
      assets: r.total_assets ?? null,
      marginPct: r.operating_margin_pct ?? null,
      sharePct: r.revenue_share_pct ?? null,
      currency: r.currency_code ?? null,
      periodEnding: r.period_ending ?? null,
      children: nestedByParent.get(r.member_code) ?? [],
    }));

  // ONE AXIS PER KIND. A filer can disclose two axes of the same kind — `srt:ProductOrServiceAxis`
  // and a coarse Product/Service split are both `product` — and they are ALTERNATIVE descriptions
  // of the same company, not additive. The richest one is the useful one.
  // A PERIOD BELONGS TO A DIMENSION, NOT TO A COMPANY — see `segment-dimensions.ts`. Extracted
  // there because it is pure and this module cannot be driven offline.
  const grouped = groupByDimension(lines, KINDS);
  const byKind = grouped.byKind as Map<SegmentKind, SegmentLine[]>;
  const periodByKind = grouped.periodByKind as Map<SegmentKind, string | null>;

  return {
    /** Dimensions this filer actually discloses, in the order the tabs should offer them. */
    kinds: KINDS.filter((k) => byKind.has(k)),
    byKind,
    currency: lines.find((l) => l.currency)?.currency ?? null,
    /**
     * PER DIMENSION, deliberately. A single `periodEnding` was wrong for 66 of the 210 securities
     * that disclose more than one — the panel showed one year above whichever tab was selected, so
     * switching the dimension changed the numbers and not the caption.
     */
    periodByKind,
    loading: query.isPending && !!securityId,
    // PENDING IS NOT MISSING. 66 securities have business lines against ~12,000 in the universe,
    // so "nothing yet" is by far the common state and must not flash on every stock page.
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while `securityId` is null — and the
    // section then renders a card with a heading and nothing under it, which is the one thing this
    // page's convention forbids. Observed in a browser with the instrument unresolved: every
    // section on the stock page drew an empty card. `loading` already guards on `securityId`;
    // `empty` must too.
    empty: !(query.isPending && !!securityId) && byKind.size === 0,
  };
}
