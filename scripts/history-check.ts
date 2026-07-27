/**
 * Proves the execution tree is reconstructable from LangGraph's OWN checkpoints,
 * against the live deployment — the premise Phase 4 (deleting `agent_capture`) rests
 * on. Also records per-namespace read latency, since that is what decides whether the
 * lazy-on-expand UX is acceptable.
 *
 *   CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… npx tsx scripts/history-check.ts
 */
import { Client } from '@langchain/langgraph-sdk';

import {
  fetchNamespace,
  messagesFromSnapshots,
  nodesFromSnapshots,
} from '../src/lib/agent/run-history';

const API = process.env.MUFFIN_API ?? 'https://muffin-api.rafiki.guru';
const THREADS = {
  trading: '019f81a0-0ccd-7301-9710-e4ccea8ddb95',
  criteria: '019f98e1-b104-7742-a893-4b1a9a388366',
};

function client(): Client {
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('CF_ACCESS_CLIENT_ID / _SECRET required');
  return new Client({
    apiUrl: API,
    defaultHeaders: { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret },
  });
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const out = await fn();
  return [out, Date.now() - t0];
}

async function main(): Promise<void> {
  const c = client();

  console.log('\ntrading_decision — root topology from checkpoints alone');
  const [rootSnaps, rootMs] = await timed(() => fetchNamespace(c, THREADS.trading));
  const roots = nodesFromSnapshots(rootSnaps);
  console.log(`  root history: ${rootSnaps.length} snapshots in ${rootMs}ms`);
  for (const n of roots) console.log(`    ${n.label.padEnd(24)} ${n.namespace ? 'drillable' : 'leaf'}`);

  check('found the four analysts', ['Market analyst', 'Fundamentals analyst', 'News analyst', 'Social analyst']
    .every((l) => roots.some((n) => n.label === l)));
  check('both debates are drillable', roots.filter((n) => /debate/i.test(n.label) && n.namespace).length === 2);
  check('plain LLM nodes are leaves', roots.some((n) => /judge|trader|portfolio/i.test(n.label) && !n.namespace));
  check('no middleware plumbing leaked in', !roots.some((n) => /middleware/i.test(n.label)));

  console.log('\ntrading_decision — an analyst namespace carries its transcript + tool calls');
  const analyst = roots.find((n) => n.label === 'Market analyst');
  if (!analyst?.namespace) {
    check('market_analyst namespace present', false);
  } else {
    const [snaps, ms] = await timed(() => fetchNamespace(c, THREADS.trading, analyst.namespace));
    const msgs = messagesFromSnapshots(snaps) as { type?: string; tool_calls?: unknown[] }[];
    const byType = msgs.reduce<Record<string, number>>((a, m) => {
      a[m.type ?? '?'] = (a[m.type ?? '?'] ?? 0) + 1;
      return a;
    }, {});
    const toolCalls = msgs.flatMap((m) => m.tool_calls ?? []);
    console.log(`    ${ms}ms · ${msgs.length} messages ${JSON.stringify(byType)} · ${toolCalls.length} tool calls`);
    check('transcript present', msgs.length > 0, `${msgs.length} messages`);
    check('tool calls present', toolCalls.length > 0, `${toolCalls.length}`);
    check('tool results present', (byType.tool ?? 0) > 0, `${byType.tool ?? 0} ToolMessages`);
  }

  console.log('\nlatency profile (decides lazy-on-expand UX)');
  const [, critMs] = await timed(() => fetchNamespace(c, THREADS.criteria, undefined, 8));
  console.log(`    trading root ${rootMs}ms · criteria root ${critMs}ms`);
  check('reads complete', rootMs > 0 && critMs > 0);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
