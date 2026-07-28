/**
 * Structural gate for the execution tree. Imports the REAL modules, so a regression in
 * `exec-tree.ts` / `run-history.ts` fails here instead of quietly diverging from a
 * hand-maintained copy (which is what the `.mjs` ports this replaced always did).
 *
 *   npx tsx scripts/exectree-check.ts            # offline; no credentials needed
 *   npx tsx scripts/exectree-check.ts --fetch    # refresh the prod fixtures first
 *
 * ## Why the topology fixtures are synthetic
 *
 * The tree is now read from checkpoint **history**, not from thread `values`, and a
 * history snapshot's shape is fixed by `langgraph_api/state.py`
 * (`state_snapshot_to_thread_state`) and the SDK's `ThreadTask` type — `{id, name,
 * result, error, checkpoint}`. Encoding that shape here keeps the gate runnable
 * offline and lets it exercise cases a captured fixture can't reliably contain (an
 * errored task, a task that never got a `ToolMessage` back).
 *
 * End-to-end confirmation against the live deployment is `scripts/history-check.ts`,
 * which needs CF Access credentials.
 *
 * Fetching needs: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, MUFFIN_API (default prod).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { childrenForStage, walkTree, type ExecNode, type StageLike } from '../src/lib/agent/exec-tree';
import {
  messagesFromSnapshots,
  nodesFromSnapshots,
  taskWrite,
  toolRunsFromMessages,
  type HistorySnapshot,
} from '../src/lib/agent/run-history';

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

type TaskSpec = {
  id: string;
  name: string;
  ns?: string;
  result?: unknown;
  error?: string | null;
};

/** An AIMessage carrying one tool call, in the serialized shape history returns. */
function aiCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return { type: 'ai', content: '', tool_calls: [{ id, name, args }] };
}
const toolResult = (id: string, content = 'ok') => ({ type: 'tool', tool_call_id: id, content });

/** One history snapshot carrying the given tasks, in the API's own shape. */
function snapshot(tasks: TaskSpec[], values: Record<string, unknown> = {}): HistorySnapshot {
  return {
    values,
    next: [],
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      error: t.error ?? null,
      interrupts: [],
      result: t.result,
      checkpoint: t.ns ? { thread_id: 'T', checkpoint_ns: t.ns } : null,
      state: null,
    })),
    metadata: {},
    created_at: null,
    checkpoint: null,
    parent_checkpoint: null,
  } as unknown as HistorySnapshot;
}

/** getHistory returns newest-first — build the list the same way. */
function history(...oldestFirst: HistorySnapshot[]): HistorySnapshot[] {
  return [...oldestFirst].reverse();
}

async function main(): Promise<void> {
  if (process.argv.includes('--fetch')) await fetchThreads();

  console.log('\nroot topology — what is drillable, and what is plumbing');
  {
    // Mirrors trading_decision: four analysts + two debates are compiled subgraphs
    // (namespaced), while judge/trader/portfolio_manager are plain function nodes.
    const snaps = history(
      snapshot([{ id: '1', name: 'market_analyst', ns: 'market_analyst:u1' }]),
      snapshot([
        { id: '1', name: 'market_analyst', ns: 'market_analyst:u1' }, // repeat
        { id: '2', name: 'AgentCaptureMiddleware.after_agent' },
        { id: '3', name: '__start__' },
      ]),
      snapshot([{ id: '4', name: 'investment_judge' }, { id: '5', name: 'trader', error: 'boom' }]),
    );
    const nodes = nodesFromSnapshots(snaps);
    check('middleware + sentinels filtered', !nodes.some((n) => /Middleware|__start__/.test(n.name ?? '')));
    check('repeated tasks de-duplicate', nodes.filter((n) => n.name === 'market_analyst').length === 1);
    check('execution order preserved', nodes.map((n) => n.name).join(',') === 'market_analyst,investment_judge,trader');
    check('compiled subgraphs are drillable', nodes.find((n) => n.name === 'market_analyst')?.namespace === 'market_analyst:u1');
    // Pattern C: a plain function node has no namespace. That is a leaf by
    // construction, not a missing branch — the UI must not offer a drill-down.
    check('plain function nodes are leaves', !nodes.find((n) => n.name === 'investment_judge')?.namespace);
    check('errors surface as status', nodes.find((n) => n.name === 'trader')?.status === 'error');
  }

  console.log('\nfan-out — the criteria double-nesting repro');
  {
    // 11 parallel Send workers, all the SAME graph node. The old builder split
    // `|`-joined ids and synthesized an ancestor per prefix, labelling it from the
    // id segment while its only real child took the same string from the builder's
    // static agent name — "Criterion evaluation > Criterion evaluation".
    const snaps = history(
      snapshot(
        Array.from({ length: 11 }, (_, i) => ({
          id: `c${i}`,
          name: 'criterion_evaluation',
          ns: `criterion_evaluation:u${i}`,
          result: { criterion_evaluations: [{ criterion_name: `Criterion ${i}`, signal: 'bullish' }] },
        })),
      ),
    );
    const nodes = nodesFromSnapshots(snaps);
    check('one node per worker, no synthesized levels', nodes.length === 11);
    check('workers are flat, not nested', nodes.every((n) => n.children.length === 0));
    let dupes = 0;
    walkTree(nodes, (n) => {
      const child = n.children.find((c) => c.label === n.label);
      if (child) dupes += 1;
    });
    check('no node repeats its parent label', dupes === 0, `${dupes} duplicate pair(s)`);
    // Names come from each task's own channel writes — never from index-pairing
    // against `values.criterion_evaluations`, whose order is completion order.
    const named = taskWrite(nodes[3].output, 'criterion_evaluations') as { criterion_name?: string };
    check('worker names come from the task result', named?.criterion_name === 'Criterion 3', named?.criterion_name ?? '-');
    check('taskWrite unwraps $writes', taskWrite({ k: { $writes: [[{ v: 1 }]] } }, 'k') !== undefined);
    check('taskWrite tolerates a missing channel', taskWrite({}, 'nope') === undefined);
  }

  console.log('\ntool calls — derived from the transcript, not a capture channel');
  {
    const messages = [
      { type: 'human', content: 'go' },
      {
        type: 'ai',
        content: '',
        tool_calls: [
          { id: 'a', name: 'get_indicators', args: { ticker: 'NVDA' } },
          { id: 'b', name: 'get_news', args: {} },
          { id: 'c', name: 'never_returned', args: {} },
        ],
      },
      { type: 'tool', tool_call_id: 'a', content: 'ok', status: 'success' },
      { type: 'tool', tool_call_id: 'b', content: 'kaboom', status: 'error' },
    ];
    const runs = toolRunsFromMessages(messages, 'market_analyst');
    check('every tool call becomes a run', runs.length === 3, `${runs.length}`);
    check('results pair by tool_call_id', runs.find((r) => r.tool === 'get_indicators')?.status === 'ok');
    check('errors are marked', runs.find((r) => r.tool === 'get_news')?.status === 'error');
    // A cancelled run leaves a call with no ToolMessage. Dropping it would hide
    // exactly the case a reader most needs to see.
    check('unanswered calls are kept as pending', runs.find((r) => r.tool === 'never_returned')?.status === 'pending');
    check('runs are attributed to the node', runs.every((r) => r.agent === 'market_analyst'));
    check('a transcript with no calls yields none', toolRunsFromMessages([{ type: 'ai', content: 'hi' }]).length === 0);
  }

  console.log('\ntranscripts come from the namespace\'s own messages channel');
  {
    // Read straight from `values.messages`. This briefly went through a
    // reconstruction from task writes because every deep agent reported an
    // empty channel — an upstream bug (langchain-ai/langgraph#8470), since
    // fixed, where a nested subgraph had no saver to replay its DeltaChannel.
    const snaps = history(
      snapshot([{ id: 'p', name: '_InputPromptMiddleware.before_agent' }], {
        messages: [{ type: 'human', content: 'classify AAPL' }],
      }),
      snapshot([{ id: 'm1', name: 'model' }], {
        messages: [
          { type: 'human', content: 'classify AAPL' },
          aiCall('c1', 'task', { subagent_type: 'equity-fundamentals' }),
          toolResult('c1', 'report'),
        ],
      }),
    );
    const msgs = messagesFromSnapshots(snaps) as { type?: string }[];
    check('richest snapshot wins', msgs.length === 3, `${msgs.length} messages`);
    check('order preserved', msgs.map((m) => m.type).join(',') === 'human,ai,tool');
    // This is what makes "which sub-agents did it call" answerable: a `task`
    // delegation is a real tool call in the transcript.
    const runs = toolRunsFromMessages(msgs);
    check('the task delegation is visible as a tool call', runs.some((r) => r.tool === 'task'));
    check('and it is paired with its result', runs.find((r) => r.tool === 'task')?.status === 'ok');
    check('an empty channel yields nothing', messagesFromSnapshots(history(snapshot([], { messages: [] }))).length === 0);
  }

  console.log('\nagent-internal loop nodes are not execution steps');
  {
    const snaps = history(
      snapshot([
        { id: '1', name: 'model' },
        { id: '2', name: 'tools' },
        { id: '3', name: 'collect_data', ns: 'collect_data:u1' },
      ]),
    );
    const names = nodesFromSnapshots(snaps).map((n) => n.name);
    // Without this filter every agent renders a "Model, Tools, Model, Tools…"
    // ladder, which is noise: what they did is in the transcript.
    check('model/tools filtered out', !names.includes('model') && !names.includes('tools'), names.join(','));
    check('real sub-agents survive', names.includes('collect_data'));
  }

  console.log('\ndeep-agent sub-agents surface as named rows');
  {
    // A ToolNode task reports `checkpoint: null`, but the sub-agent it spawned
    // checkpoints under `<parent>|tools:<task id>`. Pairing the `task` call
    // (which names the sub-agent) with its ToolMessage turns an anonymous
    // "Tools" step into a named, drillable row. Verified against prod thread
    // 019fa546: "Define the criteria" yields 5 rows whose namespaces match the
    // 5 `|tools:` namespaces in the database exactly.
    const snaps = history(
      snapshot([
        { id: 'm1', name: 'model', result: { messages: [aiCall('c1', 'task', { subagent_type: 'equity-fundamentals' })] } },
      ]),
      snapshot([{ id: 't1', name: 'tools', result: { messages: [{ ...toolResult('c1', 'report'), name: 'task' }] } }]),
      // An ordinary tool call through the same node — NOT a sub-agent.
      snapshot([
        { id: 'm2', name: 'model', result: { messages: [aiCall('c2', 'get_prices', { ticker: 'AAPL' })] } },
      ]),
      snapshot([{ id: 't2', name: 'tools', result: { messages: [toolResult('c2', '{...}')] } }]),
    );
    const nodes = nodesFromSnapshots(snaps, 'criteria_definition:u1');
    check('one row per delegation', nodes.length === 1, nodes.map((n) => n.label).join(',') || '(none)');
    check('named after the sub-agent, not "Tools"', nodes[0]?.label === 'Equity fundamentals', nodes[0]?.label ?? '-');
    check(
      'namespace derived as <parent>|tools:<task id>',
      nodes[0]?.namespace === 'criteria_definition:u1|tools:t1',
      nodes[0]?.namespace ?? '-',
    );
    // The plain tool call stays out of the tree; it is in the transcript.
    check('ordinary tool calls do not become rows', !nodes.some((n) => n.name === 'get_prices'));
    // At the root there is no parent segment to prefix.
    const atRoot = nodesFromSnapshots(snaps);
    check('root has no parent prefix', atRoot[0]?.namespace === 'tools:t1', atRoot[0]?.namespace ?? '-');
  }

  console.log('\nstage → topology join');
  {
    const topology: ExecNode[] = [
      { id: '1', label: 'Market analyst', name: 'market_analyst', kind: 'agent', children: [] },
      { id: '2', label: 'Bull researcher', name: 'bull_researcher', kind: 'agent', children: [] },
    ];
    const byNode: StageLike = { key: 'm', label: 'Market', node: 'market_analyst' };
    // The join used to consult `stage.node` alone, so every stage declaring only
    // `active` — all council stages, all four trading analysts — matched nothing.
    const byActive: StageLike = { key: 'd', label: 'Debate', active: /researcher/i };
    check('exact node match binds', childrenForStage(byNode, topology).length === 1);
    check('regex-only stages bind too', childrenForStage(byActive, topology).length === 1);
    check('a stage matching nothing binds nothing', childrenForStage({ key: 'x', label: 'x' }, topology).length === 0);
    check(
      'node takes precedence over active',
      childrenForStage({ key: 'm', label: 'M', node: 'market_analyst', active: /researcher/i }, topology)[0]?.name ===
        'market_analyst',
    );
  }

  console.log('\ntrading_decision — debate output shape (prod fixture)');
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

  console.log('\nempty run degrades cleanly');
  {
    check('no snapshots, no crash', nodesFromSnapshots([]).length === 0);
    check('snapshots with no tasks, no crash', nodesFromSnapshots([snapshot([])]).length === 0);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
