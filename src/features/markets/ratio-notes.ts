/**
 * The words under a valuation chart: why a price ratio is withheld, and which earnings a P/E uses.
 *
 * Kept out of the component, which imports react-native, so `scripts/ratio-notes-check.ts` can
 * assert it offline. Every case here is a different fact, and the earlier single message stated
 * the wrong one for two of them.
 *
 * A PRICE RATIO IS WITHHELD FOR THREE REASONS, and each needs its own sentence:
 *   * the listing's currency is not known. Since muffin-deployment#433 the quote currency is the
 *     bar's own label, and a bar the price lane could not label has none: London lines are in
 *     that state until `GBX` is deployed and their next chart visit relabels them. "Trades in a
 *     different one" would be false there: nothing says it differs.
 *   * the reporting currency is not known: no metric states one and the company has none recorded.
 *   * both are known and differ, and no exchange rate is held for the bar. Dividing one by the
 *     other would be wrong by the exchange rate and look ordinary.
 */

/** Why a price-based ratio is withheld, given the currencies the view reported. */
export function withheldNote(
  ratioName: string,
  reportCurrency: string | null,
  quoteCurrency: string | null,
): string {
  if (!quoteCurrency) {
    return `No ${ratioName} yet: the currency this listing trades in is not known, and a price in an unknown unit can be a hundred times out.`;
  }
  if (!reportCurrency) {
    return `No ${ratioName}: the currency this company reports in is not known, so its earnings cannot be set against a price in ${quoteCurrency}.`;
  }
  return `No ${ratioName}: this company reports in ${reportCurrency} and trades in ${quoteCurrency}, and no exchange rate is held for these dates. Dividing one by the other would give a number that looks ordinary and is wrong by the exchange rate.`;
}

/**
 * Which earnings a P/E divides by. The view takes a trailing twelve months where the company has
 * one and its latest fiscal year where it has none; semi-annual reporters never have one, because
 * Yahoo states no interim earnings for them. Null for a basis this does not know, rather than
 * guessing a label.
 */
const BASIS: Record<string, string> = {
  ttm: 'On trailing twelve-month earnings.',
  annual: 'On the latest fiscal year’s earnings: this company has no trailing twelve months.',
};

export function basisNote(epsBasis: string | null): string | null {
  return epsBasis ? (BASIS[epsBasis] ?? null) : null;
}
