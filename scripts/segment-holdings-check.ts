/**
 * Offline checks for the per-line holdings row. No network, no React.
 *
 * The failures this guards against are both silent on a page: a figure the filing does not carry
 * rendered as a dash (which reads as an incomplete measurement rather than an undisclosed one),
 * and an empty container rendered for a line that discloses nothing.
 */
import { holdingParts } from '../src/features/markets/segment-holdings';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nsegment holdings — the filer chooses which it discloses');

const none = holdingParts({ assets: null, longLivedAssets: null, goodwill: null });
check(none.length === 0,
  'a line disclosing none yields NO parts — the caller renders nothing, not an empty row',
  `${none.length}`);

// Amazon's shape: long-lived assets by geography, no segment assets on that axis.
const geo = holdingParts({ assets: null, longLivedAssets: 180_000_000_000, goodwill: null });
check(geo.length === 1 && geo[0].label === 'Long-lived' && geo[0].value === 180_000_000_000,
  'a geography line with only long-lived assets yields exactly that one part',
  JSON.stringify(geo));

// A business segment that discloses assets and goodwill but not long-lived.
const seg = holdingParts({ assets: 12_500_000_000, longLivedAssets: null, goodwill: 1_806_564_000 });
check(seg.length === 2 && seg.map((p) => p.label).join(',') === 'Assets,Goodwill',
  'an absent middle figure is OMITTED, not dashed — a dash reads as unmeasured rather than undisclosed',
  seg.map((p) => p.label).join(','));

const all = holdingParts({ assets: 3, longLivedAssets: 2, goodwill: 1 });
check(all.map((p) => p.label).join(',') === 'Assets,Long-lived,Goodwill',
  'order is broadest measure first, matching how a balance sheet reads');

// ZERO IS A DISCLOSED FIGURE. A segment can genuinely carry no goodwill — Apple does — and
// dropping it would silently turn "we own none" into "they did not say".
const zero = holdingParts({ assets: null, longLivedAssets: null, goodwill: 0 });
check(zero.length === 1 && zero[0].value === 0,
  'a disclosed ZERO is kept — a segment with no goodwill said so, and Apple is exactly that case',
  JSON.stringify(zero));

// NaN cannot reach the formatter: `formatMoney` would render it, and a chart labelled NaN is worse
// than a missing one.
const bad = holdingParts({ assets: Number.NaN, longLivedAssets: null, goodwill: null });
check(bad.length === 0, 'a non-finite value is dropped rather than formatted', `${bad.length}`);

console.log(failures === 0 ? '\nALL SEGMENT HOLDINGS CHECKS PASSED' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
