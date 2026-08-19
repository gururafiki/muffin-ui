// The security universe, against the DEPLOYED server, as ANON.
//
// WHY THIS NEEDS THE REAL SERVER. Every property below is a property of the deployment, not of the
// TypeScript: whether a filter is applied server-side, whether the true total comes back, and
// whether the query survives anon's 3s statement timeout. `smoke-market.mjs` deliberately MOCKS
// Supabase, so it cannot see any of them.
//
// It exists because all three have already failed here:
//   * `security_facets` returned `57014 canceling statement due to statement timeout` to anon for
//     any TWO-filter conjunction while every single-filter probe said it was healthy, and while
//     service_role — which has no statement timeout — said it was healthy too.
//   * A `.limit(n)` above PGRST_DB_MAX_ROWS is not an error, just a shorter answer: asking for
//     4,000 rows silently returns 1,000. Three separate guards in this codebase have reported
//     "1000" as a measurement.
//   * A filter that never reaches the server yields a plausible list of the wrong rows.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... npx tsx scripts/universe-check.ts
//
// Credentials come from the environment and are never committed.
const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, '');
const ANON = process.env.SUPABASE_ANON_KEY;

if (!URL_BASE || !ANON) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required (this check drives the deployment).');
  process.exit(2);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const SELECT =
  'security_id,symbol,name,security_type_code,sector_id,industry,country_iso2,country_name,' +
  'cap_band,market_cap_usd,currency_code,style,style_source,style_confidence,value_score,refreshed_at';

interface PageResult { status: number; total: number | null; rows: Record<string, unknown>[]; ms: number }

async function page(query: string, range = '0-49'): Promise<PageResult> {
  const url =
    `${URL_BASE}/rest/v1/security_facets?select=${SELECT}` +
    `&order=market_cap_usd.desc.nullslast,security_id.asc${query}`;
  const started = Date.now();
  const res = await fetch(url, {
    headers: {
      apikey: ANON!,
      Authorization: `Bearer ${ANON!}`,
      'Accept-Profile': 'market',
      Prefer: 'count=exact',
      Range: range,
      'User-Agent': 'muffin-universe-check/1.0',
    },
  });
  const ms = Date.now() - started;
  // The TRUE total, from content-range. Never `rows.length` — that is a page.
  const cr = res.headers.get('content-range');
  const total = cr && cr.includes('/') ? Number(cr.split('/')[1]) : null;
  const rows = res.ok ? ((await res.json()) as Record<string, unknown>[]) : [];
  return { status: res.status, total: Number.isFinite(total) ? total : null, rows, ms };
}

const BUDGET_MS = 3000; // anon's statement timeout

// `tsx` transforms to CJS here, which does not support top-level await, so the whole driver
// lives in main(). Node 20.9 is the pinned local version (see CLAUDE.md).
async function main(): Promise<void> {
  console.log('\n## the universe is reachable by anon, and the total is COUNTED not inferred');
  const all = await page('');
  check('unfiltered page returns rows', all.rows.length > 0, `${all.rows.length} rows, HTTP ${all.status}`);
  check('a true total came back in content-range', all.total !== null, String(all.total));
  check(
    'the total is the UNIVERSE, not the page',
    (all.total ?? 0) > all.rows.length,
    `${all.total} total vs ${all.rows.length} returned`,
  );
  check(`under anon's ${BUDGET_MS}ms statement timeout`, all.ms < BUDGET_MS, `${all.ms}ms`);

  console.log('\n## every filter is applied BY THE SERVER (the total must shrink)');
  const cases: { label: string; q: string }[] = [
    { label: 'msci_tier', q: '&msci_tier=eq.developed' },
    { label: 'sector_id', q: '&sector_id=eq.financials' },
    { label: 'cap_band', q: '&cap_band=eq.large' },
    { label: 'style', q: '&style=eq.value' },
    { label: 'income_group', q: '&income_group=eq.high' },
    { label: 'country_iso2', q: '&country_iso2=eq.JP' },
    { label: 'security_type_code', q: '&security_type_code=eq.bond' },
  ];
  for (const c of cases) {
    const r = await page(c.q);
    check(
      `${c.label} narrows the universe server-side`,
      r.status < 300 && r.total !== null && r.total < (all.total ?? Infinity),
      `HTTP ${r.status}, ${r.total} of ${all.total}`,
    );
  }

  console.log('\n## CONJUNCTIONS are the case that actually broke — probe them, not one filter at a time');
  const conj: { label: string; q: string }[] = [
    { label: 'tier + sector', q: '&msci_tier=eq.developed&sector_id=eq.financials' },
    { label: 'tier + sector + cap', q: '&msci_tier=eq.developed&sector_id=eq.financials&cap_band=eq.large' },
    { label: 'style + cap + tier', q: '&style=eq.value&cap_band=eq.large&msci_tier=eq.emerging' },
    {
      label: '5-way',
      q: '&msci_tier=eq.developed&security_type_code=eq.equity&cap_band=eq.large&style=eq.value&sector_id=eq.industrials',
    },
  ];
  for (const c of conj) {
    const r = await page(c.q);
    check(`${c.label} answers within budget`, r.status < 300 && r.ms < BUDGET_MS, `HTTP ${r.status}, ${r.ms}ms`);
  }

  console.log('\n## deep pagination does not degrade (an offset far into 27k rows)');
  const deep = await page('', '10000-10049');
  check('page 200 answers within budget', deep.status < 300 && deep.ms < BUDGET_MS, `HTTP ${deep.status}, ${deep.ms}ms`);
  check('page 200 returns rows', deep.rows.length > 0, `${deep.rows.length} rows`);

  console.log('\n## the spine reports its own age (a snapshot that stops refreshing must be visible)');
  const first = all.rows[0] as { refreshed_at?: string } | undefined;
  check('refreshed_at is present', !!first?.refreshed_at, String(first?.refreshed_at));
  if (first?.refreshed_at) {
    const ageH = (Date.now() - new Date(first.refreshed_at).getTime()) / 3_600_000;
    // The facets-refresh resource has a 60-minute TTL and the warm-up cron runs ~8x a day. A spine
    // older than a day means the resource has stopped, which is this codebase's recurring failure.
    check('the snapshot is less than 24h old', ageH < 24, `${ageH.toFixed(1)}h old`);
  }

  console.log('\n## an empty filter matches NOTHING, and is not confused with "no filter"');
  const nothing = await page('&country_iso2=in.()');
  check(
    'in.() returns zero rows rather than the universe',
    nothing.total === 0,
    `${nothing.total} rows (HTTP ${nothing.status})`,
  );

  console.log(failures === 0 ? '\nAll universe checks passed.\n' : `\n${failures} universe check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
