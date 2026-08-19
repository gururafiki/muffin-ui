/**
 * Pure row/format logic for the macro panel — no react-native imports, so it can be checked
 * offline (`scripts/macro-panel-check.ts`) exactly the way `money.ts` is.
 *
 * Both defects this holds were shape bugs that typechecked cleanly and were only visible against
 * real production data.
 */
import { formatMoney } from './money';
import type { MacroSeries } from './api/use-macro';

/** Order the categories read in, rather than alphabetically by code. */
export const CATEGORY_ORDER = ['inflation', 'labour', 'rates', 'growth'] as const;

export function rank(s: MacroSeries): number {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(s.category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/**
 * A TERM STRUCTURE IS ONE FACT, NOT ELEVEN ROWS. `us-yield-curve` returns a point per maturity, so
 * the first version of this panel rendered the US with 18 rows — 11 of them the curve — while
 * every other country had 2 or 3. Measured against production before fixing.
 *
 * These are the maturities a reader actually reads a curve by. The rest stay in the data and are
 * still served by `macro_current`; they simply do not each get a line on a summary panel.
 */
export const CURVE_POINTS = ['year_2', 'year_10', 'year_30'] as const;

export const maturityLabel = (d: string): string =>
  d.replace('year_', '').replace('month_', '') + (d.startsWith('year') ? 'Y' : 'M');

/**
 * A magnitude, printed compactly and WITHOUT a currency. US real GDP arrives as 25575729500000;
 * printed with thousands separators that is honest and unreadable. No unit is claimed — the
 * catalogue says `index` for that series, which is not something to render as `$`.
 */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * A percent is rendered without a sign because these are LEVELS. Inflation of 2.3% and a yield of
 * 4.47% are not changes, and a "+" would read as a move.
 */
export function formatValue(s: MacroSeries): string {
  if (s.unit === 'percent') return `${s.value.toFixed(2)}%`;
  // A THREE-LETTER UNIT IS A CURRENCY. `macro_indicator.unit` holds a currency code where the value
  // is money, because OECD returns GDP in each country's NATIONAL currency — a boolean "is money"
  // could not carry that, and defaulting to dollars is how the currency bug started. `formatMoney`
  // is the same CLDR-backed formatter the stock page uses, so `$` cannot drift from `CN¥`.
  if (s.unit && /^[a-z]{3}$/i.test(s.unit)) return formatMoney(s.value, s.unit);
  return compact(s.value);
}

/**
 * One row per SERIES, not per observation — this is the bug. The first version mapped
 * `macro.items` straight to rows, so a term structure became eleven lines.
 */
export function collapseRows(items: MacroSeries[]): { head: MacroSeries; group: MacroSeries[] }[] {
  const byCode = new Map<string, MacroSeries[]>();
  for (const s of items) {
    const list = byCode.get(s.code);
    if (list) list.push(s);
    else byCode.set(s.code, [s]);
  }
  return [...byCode.values()]
    .map((group) => ({ head: group[0], group }))
    .sort((a, b) => rank(a.head) - rank(b.head) || a.head.name.localeCompare(b.head.name));
}

/** The points a curve row actually shows: its benchmarks, or whatever it has if none match. */
export function curvePoints(group: MacroSeries[]): MacroSeries[] {
  const picked = CURVE_POINTS.map((d) => group.find((g) => g.dimension === d)).filter(
    (g): g is MacroSeries => !!g,
  );
  return picked.length > 0 ? picked : group.slice(0, 3);
}
