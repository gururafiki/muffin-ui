/**
 * A period belongs to a DIMENSION, not to a company.
 *
 * `security_segment_current` picks the latest annual period PER AXIS, so a filer that stopped
 * disclosing business segments but kept disclosing geographies carries two years at once. The hook
 * derived ONE period across every line of every dimension and the panel captioned whichever tab was
 * selected with it, so switching the dimension changed the numbers and not the year. Measured on
 * production 2026-09-05: of 210 securities disclosing more than one dimension, 66 disagree on the
 * year, and the widest gap is 14 years — a 2011 breakdown captioned FY2025.
 */
import { groupByDimension } from '../src/features/markets/segment-dimensions';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const KINDS = ['product', 'business', 'geography'] as const;

// GE VERNOVA'S SHAPE. The fixture makes the dimensions DISAGREE on year — with both at 2025 a
// single shared period is indistinguishable from a per-dimension one and the bug is invisible.
const gev = [
  { kind: 'business', axis: 'us-gaap:StatementBusinessSegmentsAxis', periodEnding: '2022-12-31' },
  { kind: 'business', axis: 'us-gaap:StatementBusinessSegmentsAxis', periodEnding: '2022-12-31' },
  { kind: 'geography', axis: 'us-gaap:StatementGeographicalAxis', periodEnding: '2025-12-31' },
  { kind: 'geography', axis: 'us-gaap:StatementGeographicalAxis', periodEnding: '2025-12-31' },
];
{
  const { byKind, periodByKind } = groupByDimension(gev, KINDS);
  check(periodByKind.get('business') === '2022-12-31',
    'the business dimension reports its OWN year', `got ${periodByKind.get('business')}`);
  check(periodByKind.get('geography') === '2025-12-31',
    'the geography dimension reports its OWN year', `got ${periodByKind.get('geography')}`);
  check(periodByKind.get('business') !== periodByKind.get('geography'),
    'two dimensions of one filer may disagree, and the caption must follow the tab');
  check(byKind.get('business')?.length === 2 && byKind.get('geography')?.length === 2,
    'grouping is unchanged', `${byKind.get('business')?.length}/${byKind.get('geography')?.length}`);
  check(!byKind.has('product'), 'a dimension the filer does not disclose is absent');
}

// THE RICHEST AXIS OWNS THE PERIOD. A filer can tag one dimension on two axes; the period must come
// from the axis actually shown, not from whichever line sorts first. The thin axis is deliberately
// FIRST and carries a different year, so taking `lines[0]` gives the wrong answer.
{
  const twoAxes = [
    { kind: 'product', axis: 'thin:Axis', periodEnding: '2019-12-31' },
    { kind: 'product', axis: 'rich:Axis', periodEnding: '2025-12-31' },
    { kind: 'product', axis: 'rich:Axis', periodEnding: '2025-12-31' },
    { kind: 'product', axis: 'rich:Axis', periodEnding: '2025-12-31' },
  ];
  const { byKind, periodByKind } = groupByDimension(twoAxes, KINDS);
  check(byKind.get('product')?.length === 3, 'the richest axis is the one shown',
    `${byKind.get('product')?.length} members`);
  check(periodByKind.get('product') === '2025-12-31',
    'and the period comes from THAT axis, not from the first line',
    `got ${periodByKind.get('product')}`);
}

// A dimension whose lines carry no period at all reports null rather than borrowing one.
{
  const noPeriod = [
    { kind: 'business', axis: 'a:Axis', periodEnding: null },
    { kind: 'geography', axis: 'b:Axis', periodEnding: '2025-12-31' },
  ];
  const { periodByKind } = groupByDimension(noPeriod, KINDS);
  check(periodByKind.get('business') === null,
    'a dimension with no period reports null, never a neighbour\'s year',
    `got ${periodByKind.get('business')}`);
}

console.log(failures === 0 ? '\nSEGMENT DIMENSION CHECK PASSED' : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) process.exit(1);
