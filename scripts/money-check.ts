// `formatMoney` — offline, no credentials, no browser.
//
// WHY THIS EXISTS. The stock page hardcoded `$` and rendered Alibaba's CNY 1,023,670,000,000
// revenue as "$1.02T" — the largest company on earth by revenue, against a true ~$141B. The fix is
// small, and every way it can go wrong again is SILENT: a plausible number with the wrong label.
//
// Two of the three guards below were each a real bug during development, found by measuring rather
// than by reading:
//   * The LOCALE MUST STAY PINNED. `formatMoney` appends the scale suffix itself, and symbol
//     placement is a locale decision — `de-DE` renders `215,94 $`, so the append yields
//     `215,94 $B`, and `fr-FR` yields `215,94 $USB`. Only en-US/ja-JP happen to compose. A machine
//     whose default is en-US agrees with the bug, which is exactly how it survived a first check.
//   * An UNRECOGNISED CODE MAKES `Intl` THROW, and a throw during render takes a native build down
//     with no dialog and no JS error (the same rule as `new URL()` in CLAUDE.md).
//   * NO CURRENCY MUST NOT MEAN DOLLARS. ~a quarter of securities carry a currency, so the
//     unlabelled path is common; defaulting it to `$` is how this started.
import { formatMoney, formatPerShare } from '../src/features/markets/money';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n## real figures, measured from the deployed rows');
const got = (v: number, c: string | null) => formatMoney(v, c);
check('Alibaba CNY revenue is not dollars', got(1_023_670_000_000, 'CNY') === 'CN¥1.02T', got(1_023_670_000_000, 'CNY'));
check('Samsung KRW revenue is not dollars', got(97_146_675_000_000, 'KRW') === '₩97.15T', got(97_146_675_000_000, 'KRW'));
check('NVDA USD revenue still reads in dollars', got(215_940_000_000, 'USD') === '$215.94B', got(215_940_000_000, 'USD'));

console.log('\n## a "$" currency that is not USD must be distinguishable');
// Seven currencies in this universe print as "$": USD, CAD, AUD, HKD, SGD, MXN, CLP. CLDR
// disambiguates them; a hand-written symbol table is what would not.
check('MXN is not rendered as a bare "$"', !/^\$/.test(got(1_234_000_000, 'MXN')), got(1_234_000_000, 'MXN'));
check('CAD is not rendered as a bare "$"', !/^\$/.test(got(1_234_000_000, 'CAD')), got(1_234_000_000, 'CAD'));

console.log('\n## the locale is pinned, because the suffix is appended by hand');
// The failure this catches: `215,94 $B` (de-DE) and `215,94 $USB` (fr-FR). Asserted as "the
// suffix is the last character and no digit follows the symbol", which holds only if the symbol
// leads — i.e. only if the locale is not taken from the environment.
for (const scale of [1e12, 1e9, 1e6]) {
  const out = got(215.94 * scale, 'USD');
  check(`suffix stays last at ${scale.toExponential()}`, /^\$\d[\d,.]*[TBM]$/.test(out), out);
}

console.log('\n## it cannot throw, and it cannot invent a currency');
let threw = false;
try {
  got(7_800_000_000, 'ZZZ');
} catch {
  threw = true;
}
check('an unknown code does not throw', !threw);
// MEASURED: a well-formed unknown code does NOT make Intl throw — it renders the code itself,
// separated by U+00A0, not a plain space. Only a malformed code throws, and the regex blocks those.
// Compared with the NBSP normalised away, so this asserts the LABEL rather than CLDR's spacing.
const nb = (s: string) => s.replace(/ /g, ' ');
check('an unknown code still names itself', nb(got(7_800_000_000, 'ZZZ')) === 'ZZZ 7.80B', JSON.stringify(got(7_800_000_000, 'ZZZ')));
check('no currency means NO symbol, not dollars', got(7_800_000_000, null) === '7.80B', got(7_800_000_000, null));
check('a malformed currency is not passed to Intl', got(7_800_000_000, 'dollars') === '7.80B', got(7_800_000_000, 'dollars'));
check('a lowercase code from the DB still works', got(7_800_000_000, 'usd') === '$7.80B', got(7_800_000_000, 'usd'));

console.log('\n## sign and scale');
check('a negative keeps its sign', got(-3_400_000_000, 'USD') === '-$3.40B', got(-3_400_000_000, 'USD'));
// A negative net income must scale on its MAGNITUDE — comparing the signed value against the
// thresholds would drop every negative straight through to the unscaled branch.
check('a negative is scaled, not left raw', /B$/.test(got(-3_400_000_000, 'USD')), got(-3_400_000_000, 'USD'));

console.log('\n## a per-share amount is not a market cap');
// `formatMoney` drops decimals below a million because they are noise on a $4.57T figure. On a
// DIVIDEND that rounding is the entire value, so `formatPerShare` is a separate function rather
// than a flag — these two assertions are what stop it being "simplified" back into one.
check('a market-cap formatter would destroy a dividend', formatMoney(1.2087, 'USD') === '$1', formatMoney(1.2087, 'USD'));
check('a per-share amount keeps its cents', formatPerShare(1.2087, 'USD') === '$1.21', formatPerShare(1.2087, 'USD'));
// An issuer paying fractions of a cent must not render as "$0.00", which reads as no dividend.
check('a sub-cent amount does not round to zero', formatPerShare(0.0031, 'USD') === '$0.0031', formatPerShare(0.0031, 'USD'));
check('a per-share amount carries a non-USD currency', nb(formatPerShare(2.5, 'DKK')).includes('2.50'), formatPerShare(2.5, 'DKK'));
check('no currency means no symbol on a dividend', formatPerShare(1.21, null) === '1.21', formatPerShare(1.21, null));
check('zero is still zero', formatPerShare(0, 'USD') === '$0.00', formatPerShare(0, 'USD'));

console.log(failures === 0 ? '\nALL MONEY CHECKS PASSED' : `\n${failures} MONEY CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
