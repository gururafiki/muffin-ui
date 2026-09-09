/**
 * How one analyst action reads on a page. Pure, so `tsx` can assert it — `analyst-actions.tsx`
 * imports react-native and cannot be transformed offline, which is the same split `money.ts` and
 * `segment-holdings.ts` use.
 *
 * THE PROVIDER'S FIELD NAMES ARE THE OPPOSITE OF WHAT THEY SUGGEST, and that is settled upstream:
 * `market.security_price_target.target_to` is the NEW target and `target_from` the PREVIOUS one
 * (finviz calls them `adj_price_target` and `price_target`). Measured over 160 rows, `target_from`
 * is absent whenever the action opens coverage — Initiated and Resumed have no prior target — and
 * present-but-equal never occurs. Both cases are handled here rather than assumed away.
 */
import { formatPerShare } from './money';

export interface AnalystAction {
  publishedDate: string;
  analystCompany: string;
  /** The analyst's PREVIOUS target. Null when the action opens coverage. */
  targetFrom: number | null;
  /** The analyst's NEW target. Null when the action carries no target at all. */
  targetTo: number | null;
  status: string | null;
  ratingChange: string | null;
}

export interface ActionTarget {
  /** Already formatted for display, or null when the action carries no target. */
  text: string;
  /** Only when the analyst MOVED a target they already had. */
  direction: 'raised' | 'lowered' | null;
}

/**
 * The target line for one action.
 *
 * A CURRENCY IS PASSED, NEVER DEFAULTED. `formatPerShare` leaves an unrecognised code unlabelled
 * rather than inventing a dollar sign — the rule that exists because Alibaba's CNY revenue once
 * rendered as "$1.02T". The caller supplies USD because this whole table is US-listed by
 * construction, not because dollars are a safe default.
 */
export function targetFor(
  action: Pick<AnalystAction, 'targetFrom' | 'targetTo'>,
  currency: string | null | undefined,
): ActionTarget | null {
  const { targetFrom, targetTo } = action;
  // NO TARGET IS AN ORDINARY CASE — 15 of 160 measured rows are a rating change with no number.
  // Rendering a dash would read as a figure we failed to fetch rather than one never given.
  if (targetTo === null || !Number.isFinite(targetTo)) return null;

  const to = formatPerShare(targetTo, currency);
  if (targetFrom === null || !Number.isFinite(targetFrom)) return { text: to, direction: null };

  // AN UNCHANGED TARGET GETS NO ARROW. An arrow asserts a move, and a firm can reiterate a rating
  // while leaving its number alone. Measured, the two never come back equal — which is exactly why
  // this branch must exist rather than be inferred from the data happening not to contain it.
  if (targetFrom === targetTo) return { text: to, direction: null };

  return {
    text: `${formatPerShare(targetFrom, currency)} → ${to}`,
    direction: targetTo > targetFrom ? 'raised' : 'lowered',
  };
}

/**
 * The rating line, or null when there is nothing to say.
 *
 * `rating_change` is a transition (`Hold → Underperform`) 52 times in 160 and a bare rating 108
 * times. Both are shown verbatim: the bare form is the rating the analyst affirmed, and rewriting
 * either into a house style would be inventing precision the provider did not supply.
 */
export function ratingFor(action: Pick<AnalystAction, 'ratingChange'>): string | null {
  const raw = action.ratingChange?.trim();
  return raw ? raw : null;
}
