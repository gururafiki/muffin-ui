/**
 * Money, labelled with the currency it is actually in.
 *
 * The stock page scaled every figure and prefixed it with a hardcoded `$`. That is wrong for most
 * of this universe: Samsung's 2025 revenue is 97,146,675,000,000 KRW and rendered as **"$97.15T"**
 * — a US-dollar figure roughly 700x the truth, and entirely plausible-looking.
 *
 * It is also ambiguous where it is *right*. USD, CAD, AUD, HKD, SGD, MXN and CLP all print as "$",
 * and every one of them is held by a tracked fund — Grupo Carso reports in MXN, Banco de Chile in
 * CLP. A bare "$" cannot tell those apart, so the currency has to be named, not decorated.
 *
 * THE SYMBOL COMES FROM `Intl`, NOT FROM A TABLE WRITTEN HERE. CLDR already knows that KRW is ₩,
 * that JPY is ¥, and — the part a hand-written map always gets wrong — that MXN should print as
 * "MX$" rather than "$" for an en-US reader. Authoring those 40-odd rows from memory is the exact
 * mistake `market-refresh/exchanges.ts` records: the codes looked right, the samples agreed, and
 * one silently wrong entry cost 534 securities.
 */

/** The scale suffixes. Market caps and revenues here span nine orders of magnitude. */
const UNITS: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
];

/** Signed-safe: a negative net income must scale on its magnitude, not fall through to units. */
function scale(value: number): { n: number; suffix: string } {
  const abs = Math.abs(value);
  for (const [size, suffix] of UNITS) {
    if (abs >= size) return { n: value / size, suffix };
  }
  return { n: value, suffix: '' };
}

/**
 * THE LOCALE IS PINNED, and that is load-bearing — this function appends the scale suffix itself.
 *
 * Measured: `en-US` gives `$215.94` and `ja-JP` gives `$215.94`, so appending "B" is fine — but
 * `de-DE` gives `215,94 $` and `fr-FR` gives `215,94 $US`, where the same append produces
 * **`215,94 $B`** and **`215,94 $USB`**. Symbol placement is a locale decision and a suffix is not
 * something `Intl` knows about, so the two cannot be composed across locales.
 *
 * `en-US` is not a compromise here: the app's copy is English-only and every other number in it is
 * formatted with `toFixed`, i.e. already en-US decimals. Pinning makes the output deterministic
 * rather than dependent on the reader's device.
 */
const LOCALE = 'en-US';

/**
 * `Intl.NumberFormat` construction is not free and a statements card builds up to sixteen figures,
 * so formatters are reused. Keyed on what actually varies.
 */
const formatters = new Map<string, Intl.NumberFormat | null>();

function currencyFormatter(code: string, digits: number): Intl.NumberFormat | null {
  const key = `${code}:${digits}`;
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;

  let made: Intl.NumberFormat | null = null;
  try {
    made = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    // MEASURED, because the obvious assumption is wrong: a well-formed but UNKNOWN code does not
    // throw — `Intl` renders the code itself (`ZZZ 7.80`, separated by U+00A0). Only a MALFORMED
    // code throws a RangeError, and the caller's `/^[A-Za-z]{3}$/` already rejects those.
    //
    // So this catch is for the implementation, not the input: Hermes provides its own ECMA-402
    // (Android via ICU4J, iOS via Foundation), so it is not V8, and a throw during render takes a
    // native build down with no dialog and no JS error — the same rule as `new URL()` in
    // CLAUDE.md. Cached as `null` so a failure costs one construction, not one per render.
    made = null;
  }
  formatters.set(key, made);
  return made;
}

/**
 * `4.57e12` + `USD` -> `$4.57T`; `9.7e13` + `KRW` -> `₩97.15T`.
 *
 * With NO currency the number is returned unlabelled. That is deliberate: absent a currency the
 * only honest thing to say is the magnitude, and defaulting to dollars is how this bug was
 * introduced. Roughly a quarter of securities carry a currency today (`security.currency_code`,
 * from the N-PORT filing first and the yfinance metrics response second), so an unlabelled figure
 * is a real and visible state, not a theoretical one.
 */
export function formatMoney(value: number, currency: string | null | undefined): string {
  const { n, suffix } = scale(value);
  // Two decimals once scaled (4.57T), none below a million where they would be noise.
  const digits = suffix ? 2 : 0;
  const plain = n.toFixed(digits);

  const code =
    typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null;
  if (!code) return `${plain}${suffix}`;

  const fmt = currencyFormatter(code, digits);
  // The code itself is a perfectly good label when CLDR has no symbol for it.
  if (!fmt) return `${code} ${plain}${suffix}`;
  return `${fmt.format(n)}${suffix}`;
}

/**
 * A PER-SHARE amount — a dividend, not a market cap.
 *
 * `formatMoney` exists for headline figures and drops decimals below a million, where they would
 * be noise on a $4.57T number. On a dividend that rounding is the whole value: $1.2087 a share
 * renders as "$1", and a $0.24 quarterly dividend renders as "$0". So this is a SEPARATE formatter
 * rather than a flag on the other one — the same reason a metric's units are read per field here
 * instead of through one shared `pct()`, which once put NVIDIA on the deployed page at a 46%
 * dividend yield.
 *
 * Two decimals normally, four when the amount is small enough that two would round it away — some
 * issuers pay fractions of a cent, and a dividend shown as 0.00 reads as "no dividend".
 *
 * With NO currency the number is left unlabelled, exactly as `formatMoney` does: defaulting to
 * dollars is how the Alibaba bug started, and dividends here are genuinely multi-currency.
 */
export function formatPerShare(value: number, currency: string | null | undefined): string {
  const digits = Math.abs(value) < 0.01 && value !== 0 ? 4 : 2;
  const plain = value.toFixed(digits);

  const code =
    typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null;
  if (!code) return plain;

  const fmt = currencyFormatter(code, digits);
  if (!fmt) return `${code} ${plain}`;
  return fmt.format(value);
}
