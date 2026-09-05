/**
 * A segment share must be a share of something the reader can name.
 *
 * Found on the rendered page, not in a diff: Chevron showed Downstream 77.2%, Upstream 47.9% and
 * All Other 0.3% — 125.4% — beneath a caption correctly stating the shares were of the $231.37B
 * the filing totals those lines to. The caption was right and the arithmetic used reported revenue
 * ($184.43B) instead.
 *
 * THE FIXTURE MAKES THE THREE BASES DISAGREE, because a filer whose lines happen to equal revenue
 * cannot tell them apart.
 */
import { shareBasis } from '../src/features/markets/share-basis';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// CHEVRON: lines add to a filed total ABOVE reported revenue (segments before intersegment
// eliminations). The filed total is the denominator, and shares sum to 100.
{
  const r = shareBasis({ revenue: 184_432, disclosed: 231_370, filedTotal: 231_370 });
  check(r.basis === 'filed' && r.total === 231_370,
    'lines that add up to a filed total are shares OF that total, even above revenue',
    `basis=${r.basis} total=${r.total}`);
  const sum = [142_410, 88_379, 581].reduce((a, v) => a + (v / (r.total as number)) * 100, 0);
  check(Math.abs(sum - 100) < 0.5, 'and the shares sum to 100', `${sum.toFixed(1)}%`);
  const wrong = [142_410, 88_379, 581].reduce((a, v) => a + (v / 184_432) * 100, 0);
  check(Math.abs(wrong - 125.4) < 0.5,
    'the old denominator is what produced 125.4% on the page', `${wrong.toFixed(1)}%`);
}

// NOVO: the filer discloses only part of itself. Shares are of REVENUE and the gap is nameable.
{
  const r = shareBasis({ revenue: 309_064, disclosed: 114_000, filedTotal: null });
  check(r.basis === 'revenue' && r.total === 309_064,
    'a partial disclosure is shares of revenue, so the undisclosed gap can be shown',
    `basis=${r.basis}`);
}

// OVER AND RECONCILING TO NOTHING: no honest denominator exists.
{
  const r = shareBasis({ revenue: 100_000, disclosed: 400_000, filedTotal: null });
  check(r.basis === 'none' && r.total === null,
    'lines exceeding revenue that reconcile to nothing get figures and no percentages',
    `basis=${r.basis} total=${r.total}`);
}

// A filed total the lines do NOT add up to is not a denominator either.
{
  const r = shareBasis({ revenue: 100_000, disclosed: 400_000, filedTotal: 999_999 });
  check(r.basis === 'none', 'a filed total the lines miss is ignored, not trusted', `basis=${r.basis}`);
}

// No revenue at all: fall back to the lines' own sum rather than withholding everything.
{
  const r = shareBasis({ revenue: null, disclosed: 500, filedTotal: null });
  check(r.basis === 'filed' && r.total === 500,
    'with no reported revenue the split is still shown against its own total');
}

console.log(failures === 0 ? '\nSHARE BASIS CHECK PASSED' : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) process.exit(1);
