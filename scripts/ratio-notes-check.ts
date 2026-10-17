/**
 * The valuation chart says WHY a ratio is withheld and WHICH earnings a P/E uses.
 *
 * Since muffin-deployment#433 a ratio takes its quote currency from the bar, so a listing the price
 * lane has not labelled has none. The single old message then said "trades in a different one" of
 * a London line in pence, which states a difference nothing has shown. Each reason is its own
 * fact, so each case below would read wrongly under either of the others' sentences.
 */
import { basisNote, withheldNote } from '../src/features/markets/ratio-notes';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// A LONDON LINE BEFORE ITS RELABEL: the report currency is known, the quote currency is not.
{
  const n = withheldNote('P/E', 'GBP', null);
  check(/not known/.test(n) && /listing/.test(n), 'an unlabelled listing says its currency is not known', n);
  check(!/different/.test(n) && !/exchange rate is held/.test(n),
    'and claims no difference and no missing rate', n);
}

// NO REPORTING CURRENCY: a metric with none and no fallback on the company.
{
  const n = withheldNote('P/E', null, 'USD');
  check(/reports in is not known/.test(n) && /USD/.test(n), 'an unknown reporting currency is named as such', n);
}

// BOTH KNOWN, NO RATE: the ADR case.
{
  const n = withheldNote('P/E', 'DKK', 'USD');
  check(/DKK/.test(n) && /USD/.test(n) && /exchange rate/.test(n), 'a missing rate names both currencies', n);
}

// THE BASIS: two known values and nothing invented for a third.
check(/trailing twelve/.test(basisNote('ttm') ?? ''), 'ttm reads as trailing twelve months', String(basisNote('ttm')));
check(/fiscal year/.test(basisNote('annual') ?? ''), 'annual reads as the fiscal year', String(basisNote('annual')));
check(basisNote(null) === null && basisNote('quarter') === null, 'an unknown basis gets no caption');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nratio notes: every reason and basis reads as its own fact');
