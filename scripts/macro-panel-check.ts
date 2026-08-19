// The macro panel's row logic — offline, no credentials, no browser.
//
// WHY THIS EXISTS. Both defects it guards typechecked cleanly and were only visible against real
// production data:
//   1. ONE ROW PER OBSERVATION. `us-yield-curve` returns a point per maturity, so the panel
//      rendered the US with 18 rows — 11 of them the curve — while every other country had 2 or 3.
//   2. AN UNREADABLE MAGNITUDE. US real GDP arrives as 25575729500000 and printed with thousands
//      separators, which is honest and useless.
import {
  collapseRows,
  compact,
  formatValue,
  maturityLabel,
} from '../src/features/markets/macro-format';
import type { MacroSeries } from '../src/features/markets/api/use-macro';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const s = (over: Partial<MacroSeries>): MacroSeries => ({
  code: 'x',
  name: 'X',
  category: 'rates',
  countryIso2: 'US',
  unit: 'percent',
  dimension: '',
  value: 1,
  asOf: new Date('2026-08-17'),
  ...over,
});

console.log('\n## a term structure is ONE row, not eleven');
{
  const curve = ['month_1', 'month_3', 'month_6', 'year_1', 'year_2', 'year_3', 'year_5',
    'year_7', 'year_10', 'year_20', 'year_30'].map((d, i) =>
    s({ code: 'us-yield-curve', name: 'US Treasury yield curve', dimension: d, value: 3 + i * 0.1 }));
  const scalars = [
    s({ code: 'us-cpi', name: 'US inflation', category: 'inflation', value: 3.36 }),
    s({ code: 'us-unemployment', name: 'US unemployment', category: 'labour', value: 4.4 }),
  ];
  const rows = collapseRows([...curve, ...scalars]);
  check('11 curve points + 2 scalars collapse to 3 rows', rows.length === 3, `${rows.length} rows`);
  const curveRow = rows.find((r) => r.head.code === 'us-yield-curve');
  check('the curve is one row holding all its points', curveRow?.group.length === 11,
    String(curveRow?.group.length));
  // This is the regression that shipped: mapping observations straight to rows.
  check('the panel is not one row per observation', rows.length < curve.length + scalars.length,
    `${rows.length} vs ${curve.length + scalars.length} observations`);
}

console.log('\n## category order leads with what a reader looks for');
{
  const rows = collapseRows([
    s({ code: 'g', name: 'GDP', category: 'growth' }),
    s({ code: 'r', name: 'Yield', category: 'rates' }),
    s({ code: 'i', name: 'Inflation', category: 'inflation' }),
    s({ code: 'l', name: 'Unemployment', category: 'labour' }),
  ]);
  check('inflation, labour, rates, growth',
    rows.map((r) => r.head.category).join(',') === 'inflation,labour,rates,growth',
    rows.map((r) => r.head.category).join(','));
}

console.log('\n## a magnitude is readable, and claims no currency');
{
  check('US real GDP is compact', compact(25_575_729_500_000) === '25.58T', compact(25_575_729_500_000));
  check('billions', compact(1_234_000_000) === '1.23B', compact(1_234_000_000));
  check('millions', compact(4_500_000) === '4.50M', compact(4_500_000));
  check('a small number is left alone', compact(4.4) === '4.4', compact(4.4));
  check('negative magnitudes keep their sign', compact(-2_000_000_000) === '-2.00B', compact(-2_000_000_000));
  // NO "$" anywhere — the catalogue says `index` for GDP, and guessing dollars is how the currency
  // bug started.
  check('no currency symbol is invented', !compact(25_575_729_500_000).includes('$'));
}

console.log('\n## a percent is a LEVEL, not a change');
{
  check('no + sign on a level', formatValue(s({ unit: 'percent', value: 2.31 })) === '2.31%',
    formatValue(s({ unit: 'percent', value: 2.31 })));
  check('a negative percent keeps its sign', formatValue(s({ unit: 'percent', value: -0.5 })) === '-0.50%',
    formatValue(s({ unit: 'percent', value: -0.5 })));
  check('an unknown unit prints bare', formatValue(s({ unit: 'index', value: 1234.5 })) === '1,234.5',
    formatValue(s({ unit: 'index', value: 1234.5 })));
}

console.log('\n## money is rendered as money, in ITS OWN currency');
{
  // us-gdp-real was catalogued as `index` and printed 25575729500000 on the deployed page. Measured
  // against openbb: OECD gdp/real returns a USD LEVEL, so the unit is a currency code now.
  check('US GDP reads as money', formatValue(s({ unit: 'usd', value: 25_575_729_500_000 })) === '$25.58T',
    formatValue(s({ unit: 'usd', value: 25_575_729_500_000 })));
  check('gold is money too', formatValue(s({ unit: 'usd', value: 3421 })) === '$3,421',
    formatValue(s({ unit: 'usd', value: 3421 })));
  // OECD returns GDP in the country's NATIONAL currency, so a euro series must not read as dollars.
  const eur = formatValue(s({ unit: 'eur', value: 4_500_000_000_000 }));
  check('a EUR series is not dollars', !eur.startsWith('$'), eur);
  // An index level genuinely is not money.
  check('an index stays unlabelled', formatValue(s({ unit: 'index', value: 6543.21 })) === '6,543.21',
    formatValue(s({ unit: 'index', value: 6543.21 })));
}

console.log('\n## maturity labels');
{
  check('year_10 -> 10Y', maturityLabel('year_10') === '10Y', maturityLabel('year_10'));
  check('month_3 -> 3M', maturityLabel('month_3') === '3M', maturityLabel('month_3'));
}

console.log(failures === 0 ? '\nAll macro-panel checks passed.\n' : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
