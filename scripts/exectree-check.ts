/**
 * Structural gate for the execution tree, run against REAL production threads.
 *
 * Replaces `exectree-check.mjs` + `buildforest-check.mjs`, which were hand-maintained
 * JS ports of the tree builders ("Keep in sync by hand", said their own headers). They
 * drifted by construction. This imports the REAL module, so a regression in
 * `exec-tree.ts` fails the gate instead of quietly diverging from a copy.
 *
 *   npx tsx scripts/exectree-check.ts            # uses fixtures/threads/*.json
 *   npx tsx scripts/exectree-check.ts --fetch    # re-pull the threads first
 *
 * Fetching needs CF Access service-token headers in the environment:
 *   CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, MUFFIN_API (default prod).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildTopology,
  collectTopology,
  toolRunsForStage,
  walkTree,
  type ExecNode,
  type StageLike,
} from '../src/lib/agent/exec-tree';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'threads');

/** Prod threads with known, hand-verified shapes. */
const THREADS: Record<string, string> = {
  criteria: '019f98e1-b104-7742-a893-4b1a9a388366',
  stockeval: '019f9e96-9e51-7268-a44c-fd860e7c51d1',
  trading: '019f81a0-0ccd-7301-9710-e4ccea8ddb95',
  council: '019f901f-1cda-747d-8c09-b7eb2612b64a',
};

async function fetchThreads(): Promise<void> {
  const api = process.env.MUFFIN_API ?? 'https://muffin-api.rafiki.guru';
  const id = process.env.CF_ACCESS_CLIENT_ID;
  const secret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('CF_ACCESS_CLIENT_ID / _SECRET required for --fetch');
  mkdirSync(FIXTURES, { recursive: true });
  for (const [name, threadId] of Object.entries(THREADS)) {
    const res = await fetch(`${api}/threads/${threadId}`, {
      headers: { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret },
    });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(join(FIXTURES, `${name}.json`), JSON.stringify(await res.json(), null, 2));
    console.log(`  fetched ${name}`);
  }
}

function load(name: string): Record<string, unknown> {
  const path = join(FIXTURES, `${name}.json`);
  if (!existsSync(path)) throw new Error(`missing fixture ${path} — run with --fetch`);
  return (JSON.parse(readFileSync(path, 'utf8')).values ?? {}) as Record<string, unknown>;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function render(nodes: ExecNode[]): string[] {
  const lines: string[] = [];
  walkTree(nodes, (n, d) => lines.push(`${'  '.repeat(d)}${n.label} [${n.kind}]${n.summary ? ` (${n.summary})` : ''}`));
  return lines;
}

async function main(): Promise<void> {
  if (process.argv.includes('--fetch')) await fetchThreads();

  console.log('\ncriteria_analysis — the double-nesting repro');
  {
    const forest = buildTopology(collectTopology(load('criteria')));
    const labels: string[] = [];
    walkTree(forest, (n) => labels.push(n.label));
    // The bug: a synthesized "Criterion evaluation" wrapping a real node with the
    // SAME label. After collapsing, no node may share its parent's label.
    let dupes = 0;
    const walkPairs = (nodes: ExecNode[], parent?: ExecNode) => {
      for (const n of nodes) {
        if (parent && parent.label === n.label) dupes += 1;
        walkPairs(n.children, n);
      }
    };
    walkPairs(forest);
    check('no node repeats its parent label', dupes === 0, `${dupes} duplicate pair(s)`);
    check('criterion workers present', forest.length >= 11, `${forest.length} roots`);
    check('no synthetic-with-one-child survives', !render(forest).some((l, i, a) =>
      l.includes('[synthetic]') && (a[i + 1]?.startsWith(l.replace(/\S.*/, '') + '  ') ?? false)));
    console.log(render(forest).slice(0, 4).map((l) => '      ' + l).join('\n'));
  }

  console.log('\nstock_evaluation — deep-agent task subagents keep their real names');
  {
    const forest = buildTopology(collectTopology(load('stockeval')));
    const labels = forest.map((n) => n.label);
    check('9 task subagents', forest.length === 9, `${forest.length}`);
    check('named from the agent, not the node', labels.includes('Equity price'), labels.slice(0, 3).join(', '));
    check('no raw "Tools" labels', !labels.includes('Tools'));
    check('tool summaries present', forest.some((n) => !!n.summary), forest[0]?.summary ?? '-');
  }

  console.log('\ntrading_decision — stage/tool-run join');
  {
    const values = load('trading');
    const runs = (values.tool_runs ?? []) as { agent?: string }[];
    const analysts: StageLike[] = [
      { key: 'market', label: 'Market & technicals', node: 'market_analyst', active: /market_analyst/i },
      { key: 'fundamentals', label: 'Fundamentals', node: 'fundamentals_analyst', active: /fundamentals_analyst/i },
      { key: 'news', label: 'News', node: 'news_analyst', active: /news_analyst/i },
      { key: 'sentiment', label: 'Social sentiment', node: 'social_analyst', active: /social_analyst|sentiment/i },
    ];
    const attached = analysts.reduce((a, s) => a + toolRunsForStage(s, runs as never).length, 0);
    // The four analyst stages used to declare no `node`, and the join was node-only,
    // so every one of them showed zero tool calls by construction.
    check('every analyst tool run attaches to a stage', attached === runs.length, `${attached}/${runs.length}`);
    check('each analyst has some', analysts.every((s) => toolRunsForStage(s, runs as never).length > 0));

    // A stage that matches only by regex must still collect its runs.
    const regexOnly: StageLike = { key: 'x', label: 'x', active: /market_analyst/i };
    check('regex-only stages collect runs too', toolRunsForStage(regexOnly, runs as never).length > 0);
  }

  console.log('\ntrading_decision — debate output shape');
  {
    const values = load('trading');
    const msgs = values.investment_debate_messages;
    check('debate messages are a bare array', Array.isArray(msgs), `${(msgs as unknown[])?.length} turns`);
    // `stageOutput` EXTRACTS the array, so the renderer sees a list, not a wrapper
    // dict. The old detector only matched a non-array object -> raw JSON dump.
    const isMsgList =
      Array.isArray(msgs) &&
      msgs.length > 0 &&
      msgs.every((m) => !!m && typeof m === 'object' && ('type' in m || 'role' in m));
    check('array is recognisable as serialized messages', isMsgList);
  }

  console.log('\ncouncil — pre-capture thread degrades cleanly');
  {
    const forest = buildTopology(collectTopology(load('council')));
    check('empty tree, no crash', Array.isArray(forest), `${forest.length} roots`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
