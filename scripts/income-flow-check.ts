// The income-statement flow's arithmetic — offline, no credentials, no browser.
//
// WHY THIS EXISTS. A Sankey's whole claim is that the parts sum to the whole: every ribbon leaving
// a node must add up to the ribbon entering it. That is the one property the picture cannot fake
// and the one a reader will trust without checking. It is also invisible to a typecheck, and to a
// screenshot — a diagram whose stages are 3% out looks exactly like one that balances.
//
// The figures below are Amazon's real FY2025 annual metrics, read from production on 2026-09-01.
import { buildFlow, streamsInto, type MetricsAt } from '../src/features/markets/income-flow';
import { layoutFlow } from '../src/features/markets/charts/sankey-layout';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const bn = (n: number) => n * 1e9;

// Amazon FY2025, as stored. `cost_of_revenue` and `rd_expense` are genuinely absent for this filer,
// which is why the derived nodes exist at all.
const AMZN_2025: MetricsAt = new Map<string, number>([
  ['revenue', 716_924_000_000],
  ['gross_profit', 153_600_000_000],
  ['operating_income', 80_000_000_000],
  ['pretax_income', 97_300_000_000],
  ['income_tax', 19_100_000_000],
  ['net_income', 77_700_000_000],
]);
const AMZN_2024: MetricsAt = new Map<string, number>([
  ['revenue', 638_000_000_000],
  ['gross_profit', 132_000_000_000],
  ['operating_income', 68_600_000_000],
  ['pretax_income', 68_600_000_000],
  ['income_tax', 9_300_000_000],
  ['net_income', 59_200_000_000],
]);

const flow = buildFlow(AMZN_2025, AMZN_2024);
const node = (k: string) => flow.nodes.find((n) => n.key === k);
const out = (from: string) =>
  flow.links.filter((l) => l.from === from).reduce((a, l) => a + l.value, 0);

console.log('\nthe waterfall balances at every stage');
{
  // EVERY STAGE, not just the first. A diagram can balance at the trunk and be wrong further right,
  // which is exactly where the derived nodes are.
  const rev = node('revenue')!.value;
  check('revenue splits with nothing lost', Math.abs(out('revenue') - rev) < 1,
    `${(out('revenue') / 1e9).toFixed(1)}bn out of ${(rev / 1e9).toFixed(1)}bn`);

  const gross = node('gross_profit')!.value;
  check('gross profit splits with nothing lost', Math.abs(out('gross_profit') - gross) < 1,
    `${(out('gross_profit') / 1e9).toFixed(1)}bn out of ${(gross / 1e9).toFixed(1)}bn`);

  // Stage 3's input is PRETAX, not operating income — they differ by 17.3bn for this filer.
  const pretax = AMZN_2025.get('pretax_income')!;
  check('the tax stage splits its pretax input', Math.abs(out('operating_income') - pretax) < 1,
    `${(out('operating_income') / 1e9).toFixed(1)}bn out of ${(pretax / 1e9).toFixed(1)}bn pretax`);
}

console.log('\nthe derived nodes are computed, and marked');
{
  check('cost of sales is revenue minus gross profit',
    node('cost_of_sales')?.value === 716_924_000_000 - 153_600_000_000,
    `${((node('cost_of_sales')?.value ?? 0) / 1e9).toFixed(1)}bn`);
  check('operating costs is gross profit minus operating income',
    node('operating_costs')?.value === 153_600_000_000 - 80_000_000_000,
    `${((node('operating_costs')?.value ?? 0) / 1e9).toFixed(1)}bn`);
  check('both are flagged derived, so the chart can footnote them',
    node('cost_of_sales')?.derived === true && node('operating_costs')?.derived === true);
  check('a REPORTED node is not flagged derived',
    node('revenue')?.derived === false && node('net_income')?.derived === false);
}

console.log('\nthe residual is kept, not swallowed');
{
  // 97.3 − 19.1 − 77.7 = 0.5bn. Real: non-controlling interests and equity-method results.
  const other = node('other');
  check('a non-zero remainder becomes its own node', other !== undefined,
    other ? `${(other.value / 1e9).toFixed(2)}bn` : 'MISSING — the stage would not sum');
  check('and it is marked derived', other?.derived === true);

  // A company where the identity holds exactly must NOT gain an empty node.
  const exact = buildFlow(new Map([
    ['revenue', 100], ['gross_profit', 60], ['operating_income', 40],
    ['pretax_income', 40], ['income_tax', 10], ['net_income', 30],
  ]));
  check('an exact identity produces NO residual node',
    exact.nodes.every((n) => n.key !== 'other'));
}

console.log('\na stage is skipped, never guessed');
{
  const noGross = buildFlow(new Map([['revenue', 100], ['net_income', 20]]));
  check('no gross profit means no stage-1 split',
    noGross.nodes.every((n) => n.key !== 'cost_of_sales' && n.key !== 'gross_profit'),
    'a missing input must not become a zero');
  check('but the trunk still stands', noGross.nodes.some((n) => n.key === 'revenue'));

  check('no revenue means no diagram at all',
    buildFlow(new Map([['net_income', 20]])).nodes.length === 0,
    'disconnected boxes are worse than nothing');

  // A LOSS-MAKING COMPANY. Operating income is negative, so its stage cannot be drawn as a ribbon
  // — a Sankey's width is a magnitude. It must be omitted rather than drawn inverted or as zero.
  const loss = buildFlow(new Map([
    ['revenue', 100], ['gross_profit', 20], ['operating_income', -15], ['net_income', -20],
  ]));
  check('a negative operating income is omitted, not drawn',
    loss.nodes.every((n) => n.key !== 'operating_income'));
  check('and its stage-3 children go with it',
    loss.nodes.every((n) => n.key !== 'net_income' && n.key !== 'income_tax'),
    'nothing may flow from a node that was never drawn');
}

console.log('\nyear-on-year');
{
  check('revenue Y/Y is computed against the prior period',
    Math.abs((node('revenue')?.yoy ?? 0) - (716_924 - 638_000) / 638_000) < 1e-9,
    `${(((node('revenue')?.yoy ?? 0) * 100)).toFixed(1)}%`);
  check('a derived node gets a derived Y/Y',
    Math.abs((node('cost_of_sales')?.yoy ?? 0) -
      ((716_924 - 153_600) - (638_000 - 132_000)) / (638_000 - 132_000)) < 1e-9);
  check('with no prior period, Y/Y is null rather than zero',
    buildFlow(AMZN_2025).nodes.every((n) => n.yoy === null),
    'zero would read as "flat", which is a different claim from "unknown"');
}

console.log('\nthe revenue streams join the trunk');
{
  // Amazon's FY2025 product split, which reconciles to the same 716,924,000,000.
  const AMZN_REVENUE = 716_924_000_000;
  const streams = streamsInto([
    { label: 'Online stores', revenue: bn(269.287) },
    { label: 'Third-party seller services', revenue: bn(172.162) },
    { label: 'AWS', revenue: bn(128.725) },
    { label: 'Advertising', revenue: bn(68.635) },
    { label: 'Subscription services', revenue: bn(49.619) },
    { label: 'Physical stores', revenue: bn(22.561) },
    { label: 'Other', revenue: bn(5.935) },
  ], AMZN_REVENUE);
  const into = streams.links.reduce((a, l) => a + l.value, 0);
  check('every stream flows into the revenue trunk',
    streams.links.every((l) => l.to === 'revenue'));
  check('and they sum to the filed total',
    Math.abs(into - 716_924_000_000) < 1e6,
    `${(into / 1e9).toFixed(3)}bn vs 716.924bn filed`);
  check('a line with no revenue is dropped rather than drawn at zero',
    streamsInto([{ label: 'x', revenue: null }, { label: 'y', revenue: 0 }], AMZN_REVENUE).nodes.length === 0);

  // ── the streams must agree with the trunk ────────────────────────────────────────────────────
  // Measured on the deployed views before they were fixed: Apple's product split summed to 143% of
  // its own revenue and Shell's to 450%, because the serving view unioned every period. The view is
  // fixed, and 32 splits still carry a wrong reconciliation target from the parser (GE Vernova's
  // three real segments sum to 30.1bn against a recorded target of 487m), so the chart checks for
  // itself rather than trusting the pipeline.
  const twice = [
    { label: 'A', revenue: bn(400) }, { label: 'B', revenue: bn(300) },
    { label: 'A again', revenue: bn(400) }, { label: 'B again', revenue: bn(300) },
  ];
  check('a split exceeding the company\'s own revenue is not drawn at all',
    streamsInto(twice, bn(700)).nodes.length === 0,
    `${(twice.reduce((a, l) => a + (l.revenue ?? 0), 0) / 1e9).toFixed(0)}bn against a 700bn trunk`);
  check('...and 1% of rounding is tolerated, not rejected',
    streamsInto([{ label: 'A', revenue: bn(703) }], bn(700)).nodes.length === 1);

  // Under-coverage is the filer's choice, not a defect — Novo Nordisk discloses geographies
  // covering 37% of revenue. The gap is NAMED so the ribbons still sum to the trunk.
  const partial = streamsInto([{ label: 'Europe', revenue: bn(37) }], bn(100));
  check('a partial split gains an explicit undisclosed remainder',
    partial.nodes.length === 2 && partial.nodes[1].key === 'stream:undisclosed');
  check('...whose value closes the gap exactly',
    Math.abs((partial.nodes[1]?.value ?? 0) - bn(63)) < 1);
  check('...and is marked derived, since no filer reported it',
    partial.nodes[1]?.derived === true);
  check('...so the streams sum to the trunk',
    Math.abs(partial.links.reduce((a, l) => a + l.value, 0) - bn(100)) < 1);
  check('a gap under 1% is not given a node of its own',
    streamsInto([{ label: 'A', revenue: bn(99.5) }], bn(100)).nodes.length === 1);
  check('no trunk means no streams — an unchecked split is what this guard prevents',
    streamsInto([{ label: 'A', revenue: bn(10) }], null).nodes.length === 0 &&
    streamsInto([{ label: 'A', revenue: bn(10) }], 0).nodes.length === 0);
}

console.log('\nthe geometry is drawable');
{
  // THE SPARSE-COLUMN CASE IS THE COMMON ONE. A company with no disclosed segments has no column 0,
  // and d3-sankey indexes its `columns` array by layer — a hole makes `computeNodeBreadths` read
  // `.length` of undefined and THROW. 8,949 of the 9,015 securities this chart can draw take that
  // path, so this is the majority, not an edge case.
  const waterfallOnly = buildFlow(AMZN_2025);
  check('a waterfall with no segments starts at column 0',
    Math.min(...waterfallOnly.nodes.map((n) => n.depth)) === 1);
  const laid = layoutFlow(waterfallOnly.nodes, waterfallOnly.links, { width: 600, height: 320 });
  check('...and lays out without throwing', laid.nodes.length > 0, `${laid.nodes.length} nodes`);
  check('...filling the full width from x=0',
    Math.min(...laid.nodes.map((n) => n.x0)) === 0 &&
    Math.abs(Math.max(...laid.nodes.map((n) => n.x1)) - 600) < 0.5);

  // The semantic order survives layout: a node's column never contradicts the P&L's order.
  const col = new Map(laid.nodes.map((n) => [n.key, n.column]));
  check('revenue is left of gross profit, which is left of net income',
    (col.get('revenue') ?? 9) < (col.get('gross_profit') ?? -1) &&
    (col.get('gross_profit') ?? 9) < (col.get('net_income') ?? -1));
  // WHAT `nodeAlign` BUYS. d3's default (justify) pushes a node with no outgoing links to the LAST
  // column, so cost of sales — a dead end — would be drawn beside net income as though it were an
  // outcome of the business rather than the first thing subtracted from revenue.
  check('a dead-end cost sits with its siblings, not pushed to the last column',
    col.get('cost_of_sales') === col.get('gross_profit'),
    `cost_of_sales col ${col.get('cost_of_sales')}, gross_profit col ${col.get('gross_profit')}`);
  check('every ribbon has a path and a positive width',
    laid.links.length > 0 && laid.links.every((l) => l.path.startsWith('M') && l.width > 0));

  // With segments the streams occupy a real column 0 and nothing shifts.
  const streams = streamsInto([
    { label: 'AWS', revenue: bn(128.725) },
    { label: 'Online stores', revenue: bn(269.287) },
    { label: 'Other', revenue: bn(318.912) },
  ], 716_924_000_000);
  const withStreams = layoutFlow(
    [...streams.nodes, ...waterfallOnly.nodes], [...streams.links, ...waterfallOnly.links],
    { width: 600, height: 320 });
  check('adding segments adds exactly one column',
    withStreams.columns === laid.columns + 1, `${withStreams.columns} vs ${laid.columns}`);
  check('and the streams sit in it, left of revenue',
    withStreams.nodes.filter((n) => n.key.startsWith('stream:')).every((n) => n.column === 0));

  // A link whose endpoint was never drawn makes d3 throw `missing: <id>`.
  check('a link to a node that was not drawn is dropped, not thrown on',
    layoutFlow(waterfallOnly.nodes,
      [...waterfallOnly.links, { from: 'revenue', to: 'nonexistent', value: bn(1) }],
      { width: 600, height: 320 }).nodes.length > 0);
  check('a flow with no ribbons lays out as nothing',
    layoutFlow(waterfallOnly.nodes, [], { width: 600, height: 320 }).nodes.length === 0);
  check('an empty flow lays out as nothing rather than throwing',
    layoutFlow([], [], { width: 600, height: 320 }).nodes.length === 0);
  check('a zero-width container lays out as nothing',
    layoutFlow(waterfallOnly.nodes, waterfallOnly.links, { width: 0, height: 320 }).nodes.length === 0);
}

console.log(failures === 0 ? '\nALL INCOME-FLOW CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
