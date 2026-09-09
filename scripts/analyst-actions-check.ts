/**
 * Offline checks for one analyst action's display. No network, no React.
 *
 * The failures these guard against are all silent on a page: a superseded target shown as the
 * current one, an arrow asserting a move that did not happen, and a dash where the analyst simply
 * gave no number.
 */
import { ratingFor, targetFor } from '../src/features/markets/analyst-action-parts';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nanalyst actions — the new target is `targetTo`, and the old one is not the answer');

// Rosenblatt reiterating Apple, 300 -> 303. The real row.
const moved = targetFor({ targetFrom: 300, targetTo: 303 }, 'USD');
check(moved?.text === '$300.00 → $303.00' && moved?.direction === 'raised',
  'a moved target shows both numbers, new one last, and reports the direction',
  JSON.stringify(moved));

// THE HEADLINE DEFECT. Rothschild upgrading Apple: no prior target, new target 400. If the display
// ever read `targetFrom` as "the target" this row renders empty — and 55 of 160 measured rows are
// this shape, so the page would be blank a third of the time while looking deliberate.
const opened = targetFor({ targetFrom: null, targetTo: 400 }, 'USD');
check(opened?.text === '$400.00' && opened?.direction === null,
  'an Initiated action shows its only target and claims no direction',
  JSON.stringify(opened));

const lowered = targetFor({ targetFrom: 300, targetTo: 263.66 }, 'USD');
check(lowered?.direction === 'lowered', 'a cut is reported as lowered', JSON.stringify(lowered));

// 15 of 160 rows carry a rating change and no number at all.
check(targetFor({ targetFrom: null, targetTo: null }, 'USD') === null,
  'an action with no target yields NOTHING — a dash would read as a figure we failed to fetch');

// AN ARROW ASSERTS A MOVE. Measured, the provider never sends these equal; the branch exists so
// that fact staying true is not load-bearing.
const flat = targetFor({ targetFrom: 250, targetTo: 250 }, 'USD');
check(flat?.text === '$250.00' && flat?.direction === null,
  'an unchanged target gets no arrow and no direction',
  JSON.stringify(flat));

// A CURRENCY IS PASSED, NEVER DEFAULTED — the Alibaba rule. With none, the number is unlabelled
// rather than dollar-signed.
const bare = targetFor({ targetFrom: null, targetTo: 400 }, null);
check(bare?.text === '400.00',
  'with no currency the figure is left UNLABELLED rather than assumed to be dollars',
  JSON.stringify(bare));

console.log('\nthe rating line is shown verbatim, in both forms the provider sends');
check(ratingFor({ ratingChange: 'Neutral → Buy' }) === 'Neutral → Buy', 'a transition is kept whole');
check(ratingFor({ ratingChange: 'Neutral' }) === 'Neutral',
  'a bare rating is kept — it is the rating the analyst affirmed, not a missing transition');
check(ratingFor({ ratingChange: '   ' }) === null && ratingFor({ ratingChange: null }) === null,
  'blank and absent both yield nothing to render');

console.log(failures === 0 ? '\nALL ANALYST ACTION CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
