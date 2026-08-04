/**
 * Structural gate for the run timeline. Imports the REAL modules, so a regression in
 * `run-node.ts` / `run-history.ts` / `run-graph.ts` fails here instead of quietly
 * diverging from a hand-maintained copy.
 *
 *   npx tsx scripts/run-timeline-check.ts            # offline; no credentials needed
 *   npx tsx scripts/run-timeline-check.ts --fetch    # refresh the prod fixtures first
 *
 * ## Why the fixtures are synthetic
 *
 * The timeline is read from checkpoint **history**, and a snapshot's shape is fixed by
 * `langgraph_api/state.py` (`state_snapshot_to_thread_state`) and the SDK's `ThreadTask`
 * type — `{id, name, result, error, checkpoint}` plus `metadata.step`, `created_at` and
 * `next`. Encoding that shape here keeps the gate runnable offline and lets it exercise
 * cases a captured fixture can't reliably contain (an errored task, a task that never
 * got a `ToolMessage` back, a rewritten transcript).
 *
 * The synthetic shapes mirror what was measured on production 2026-08-01 — see the
 * header of `run-history.ts` for the observed superstep table. End-to-end confirmation
 * against the live deployment is `scripts/history-check.ts`, which needs CF Access
 * credentials.
 *
 * Fetching needs: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, MUFFIN_API (default prod).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AssistantGraph } from '@langchain/langgraph-sdk';

import { showsLandingHero } from '../src/features/agent-shared/run-phase';
import { BOUND, sliceAtBoundary } from '../src/lib/agent/bound-text';
import { planFromGraph, pendingNodes } from '../src/lib/agent/run-graph';
import {
  durationBetween,
  formatDuration,
  isInternalNode,
  isPassThrough,
  isPlanStale,
  laneStatus,
  walkLanes,
} from '../src/lib/agent/run-node';
import {
  lanesFromSnapshots,
  messagesFromSnapshots,
  pendingFromSnapshots,
  planFromSnapshots,
  taskWrite,
  toolRunsFromMessages,
  transcriptByStep,
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

type TaskSpec = { id: string; name: string; ns?: string; result?: unknown; error?: string | null };

/** An AIMessage carrying one tool call, in the serialized shape history returns. */
function aiCall(id: string, name: string, args: Record<string, unknown> = {}) {
  return { type: 'ai', content: '', tool_calls: [{ id, name, args }] };
}
const toolResult = (id: string, content = 'ok') => ({ type: 'tool', tool_call_id: id, content });

/**
 * One history snapshot, in the API's own shape. `step` and `at` are what the timeline
 * is built on — the previous model ignored both.
 */
function snapshot(
  step: number,
  at: string | null,
  tasks: TaskSpec[],
  values: Record<string, unknown> = {},
  next: string[] = [],
): HistorySnapshot {
  return {
    values,
    next,
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      error: t.error ?? null,
      interrupts: [],
      result: t.result,
      checkpoint: t.ns ? { thread_id: 'T', checkpoint_ns: t.ns } : null,
      state: null,
    })),
    metadata: { step },
    created_at: at,
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

  console.log('\nsupersteps become lanes — the parallel/sequential distinction');
  {
    // Mirrors the measured criteria_analysis run (thread 019faada): a sequential
    // head, a 2-wide parallel lane, then a 10-wide fan-out.
    const snaps = history(
      snapshot(0, '2026-07-28T22:31:29Z', [{ id: 't0', name: 'ticker_classification', ns: 'ticker_classification:u0' }]),
      snapshot(1, '2026-07-28T22:48:01Z', [{ id: 't1', name: 'lift_classification' }]),
      snapshot(2, '2026-07-28T22:48:01Z', [
        { id: 't2', name: 'criteria_definition', ns: 'criteria_definition:u2' },
        { id: 't3', name: 'valuation_methodology', ns: 'valuation_methodology:u3' },
      ]),
      snapshot(3, '2026-07-28T22:48:48Z', [{ id: 't4', name: 'merge_criteria' }]),
      snapshot(
        4,
        '2026-07-28T22:48:48Z',
        Array.from({ length: 10 }, (_, i) => ({
          id: `c${i}`,
          name: 'criterion_evaluation',
          ns: `criterion_evaluation:u${i}`,
          result: { criterion_evaluations: [{ criterion_name: `Criterion ${i}`, signal: 'bullish' }] },
        })),
      ),
      snapshot(5, '2026-07-28T22:53:04Z', [{ id: 't5', name: 'synthesis', ns: 'synthesis:u5' }]),
      snapshot(6, '2026-07-28T22:53:47Z', []),
    );
    const lanes = lanesFromSnapshots(snaps);

    check('one lane per non-empty superstep', lanes.length === 6, `${lanes.length}`);
    check('lane order is execution order', lanes.map((l) => l.step).join(',') === '0,1,2,3,4,5');
    // This is the whole point of the rewrite: the previous model flattened these
    // into one list, so a 10-way fan and a 10-step sequence looked identical.
    check('sequential lanes are not marked parallel', lanes[0].parallel === false);
    check('a 2-node superstep is parallel', lanes[2].parallel === true && lanes[2].nodes.length === 2);
    check('a 10-way Send fan-out is one lane', lanes[4].parallel === true && lanes[4].nodes.length === 10);

    // Durations come from consecutive checkpoint timestamps — the only timing
    // LangGraph persists. 22:31:29 -> 22:48:01 is 16m32s.
    check('lane duration spans to the next superstep', lanes[0].durationMs === 992_000, `${lanes[0].durationMs}`);
    check('duration formats compactly', formatDuration(lanes[0].durationMs) === '16m 32s', formatDuration(lanes[0].durationMs) ?? '-');
    check('the parallel lane shares one wall-clock', lanes[2].durationMs === 47_000, `${lanes[2].durationMs}`);
    check('every node carries its lane timing', lanes[4].nodes.every((n) => n.durationMs === 256_000));

    // Plain function nodes report `checkpoint: null` — leaves by construction.
    check('compiled subgraphs are drillable', lanes[0].nodes[0].namespace === 'ticker_classification:u0');
    check('plain function nodes are leaves', !lanes[1].nodes[0].namespace);

    // Fan-out members are all the same graph node, so each must label itself from
    // its OWN result — never by index-pairing against the parent's aggregate,
    // whose order is completion order.
    check('fan-out members label themselves', lanes[4].nodes[3].label === 'Criterion 3', lanes[4].nodes[3].label);
    check('labels are distinct across the fan', new Set(lanes[4].nodes.map((n) => n.label)).size === 10);
    check('single-channel writes record their channel', lanes[4].nodes[0].outputChannel === 'criterion_evaluations');
    check('lane status folds from members', laneStatus(lanes[2]) === 'done');

    let count = 0;
    walkLanes(lanes, () => (count += 1));
    check('walkLanes visits every node', count === 16, `${count}`);
  }

  console.log('\nstatus — running and pending, which the old model could never show');
  {
    const busy = history(
      snapshot(0, '2026-07-28T22:31:29Z', [{ id: 'a', name: 'ticker_classification', ns: 'tc:u0' }]),
      snapshot(1, '2026-07-28T22:48:01Z', [{ id: 'b', name: 'criteria_definition', ns: 'cd:u1' }], {}, [
        'criteria_definition',
      ]),
    );
    // History alone cannot tell "finished" from "still running": every task in a
    // completed thread and the in-flight task of a live one look the same. `busy`
    // marks only the NEWEST superstep active, which is the honest reading.
    const live = lanesFromSnapshots(busy, undefined, true);
    check('the newest superstep is active while busy', live[1].nodes[0].status === 'active');
    check('earlier supersteps stay done', live[0].nodes[0].status === 'done');
    const settled = lanesFromSnapshots(busy, undefined, false);
    check('nothing is active once idle', settled.every((l) => l.nodes.every((n) => n.status === 'done')));

    check('next names the pending nodes', pendingFromSnapshots(busy).join(',') === 'criteria_definition');
    check('a finished run has nothing pending', pendingFromSnapshots(history(snapshot(6, null, []))).length === 0);
    check(
      'sentinels never count as pending',
      pendingFromSnapshots(history(snapshot(0, null, [], {}, ['__end__']))).length === 0,
    );

    const errored = lanesFromSnapshots(
      history(snapshot(0, null, [{ id: 'e', name: 'trader', error: 'boom' }])),
      undefined,
      true,
    );
    check('an error outranks active', errored[0].nodes[0].status === 'error');
    check('lane status surfaces the error', laneStatus(errored[0]) === 'error');
  }

  console.log('\nthe static graph supplies steps that have not run yet');
  {
    // The shape verified against GET /assistants/criteria_analysis/graph.
    const graph: AssistantGraph = {
      nodes: [
        '__start__',
        'ticker_classification',
        'lift_classification',
        'criteria_definition',
        'valuation_methodology',
        'merge_criteria',
        'criterion_evaluation',
        'synthesis',
        '__end__',
      ].map((id) => ({ id })),
      edges: [
        { source: '__start__', target: 'ticker_classification', conditional: true },
        { source: 'ticker_classification', target: 'lift_classification' },
        { source: 'lift_classification', target: 'criteria_definition' },
        { source: 'lift_classification', target: 'valuation_methodology' },
        { source: 'criteria_definition', target: 'merge_criteria' },
        { source: 'valuation_methodology', target: 'merge_criteria' },
        { source: 'merge_criteria', target: 'criterion_evaluation', conditional: true },
        { source: 'criterion_evaluation', target: 'synthesis' },
        { source: 'synthesis', target: '__end__' },
      ],
    };
    const plan = planFromGraph(graph);
    check('sentinels are excluded from the plan', !plan.some((s) => isInternalNode(s.name)));
    check('every real node is planned', plan.length === 7, `${plan.length}`);
    check(
      'plan is in topological order',
      plan.map((s) => s.name).join(',') ===
        'ticker_classification,lift_classification,criteria_definition,valuation_methodology,merge_criteria,criterion_evaluation,synthesis',
      plan.map((s) => s.name).join(','),
    );
    // Longest path, not shortest: merge_criteria waits on BOTH branches, so it must
    // sort after them even though a shorter route reaches it sooner.
    check('a join sorts after both its branches', plan.findIndex((s) => s.name === 'merge_criteria') > plan.findIndex((s) => s.name === 'valuation_methodology'));

    const executed = new Set(['ticker_classification', 'lift_classification']);
    const pending = pendingNodes(plan, executed, new Set(['criteria_definition']));
    check('executed nodes drop out of pending', !pending.some((n) => executed.has(n.name)));
    check('the rest are pending, in order', pending.map((n) => n.name).join(',') === 'criteria_definition,valuation_methodology,merge_criteria,criterion_evaluation,synthesis');
    check('a node named in `next` is active, not pending', pending[0].status === 'active');
    check('the others stay pending', pending.slice(1).every((n) => n.status === 'pending'));
    check('pending nodes are never drillable', pending.every((n) => !n.namespace));

    // xray ids are `:`-joined paths, so the internal-node test must look at the
    // LAST segment or every nested middleware node leaks into the plan.
    const xray: AssistantGraph = {
      nodes: [
        { id: '__start__' },
        { id: 'ticker_classification:model' },
        { id: 'ticker_classification:_InputPromptMiddleware.before_agent' },
        { id: 'warren_buffett:collect_data' },
      ],
      edges: [{ source: '__start__', target: 'warren_buffett:collect_data' }],
    };
    const nested = planFromGraph(xray).map((s) => s.name);
    check('nested middleware is filtered', !nested.some((n) => n.includes('Middleware')), nested.join(','));
    check('nested loop nodes are filtered', !nested.includes('ticker_classification:model'));
    check('real nested nodes survive with readable labels', planFromGraph(xray)[0]?.label === 'Collect data');

    check('a missing graph degrades to an empty plan', planFromGraph(undefined).length === 0);
    check('a cyclic graph terminates', planFromGraph({
      nodes: [{ id: '__start__' }, { id: 'a' }, { id: 'b' }],
      edges: [
        { source: '__start__', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a', conditional: true },
      ],
    }).length === 2);
  }

  console.log('\nterminal pass-through nodes do not repeat their parent\'s output');
  {
    // Mirrors the criteria worker subgraph: `evaluate` (a real agent, drillable) then
    // `package`, whose only write is the channel the PARENT already reports. Rendering
    // package's output showed every criterion's card twice.
    const lanes = lanesFromSnapshots(history(
      snapshot(0, null, [{ id: 'e', name: 'evaluate', ns: 'evaluate:u1', result: { evaluation: { criterion_name: 'ROIC' } } }]),
      snapshot(1, null, [{ id: 'p', name: 'package', result: { criterion_evaluations: [{ criterion_name: 'ROIC' }] } }]),
    ));
    const evaluate = lanes[0].nodes[0];
    const pkg = lanes[1].nodes[0];
    check('the packaging node is a leaf', !pkg.namespace);
    check('and records the parent\'s channel', pkg.outputChannel === 'criterion_evaluations', pkg.outputChannel ?? '-');
    check('it is detected as a pass-through', isPassThrough(pkg, 'criterion_evaluations'));
    // The row itself must stay — it ran, and its duration is real.
    check('the row is still present', lanes.length === 2 && !!pkg.label);
    // Guards against over-firing: a node doing real work of its own is never suppressed.
    check('a drillable node is never a pass-through', !isPassThrough(evaluate, 'criterion_evaluations'));
    check('a different channel is not a pass-through', !isPassThrough(pkg, 'synthesis'));
    check('no parent channel means no suppression', !isPassThrough(pkg, undefined));
  }

  console.log('\na plan the agent stopped maintaining is reported, not hidden');
  {
    // Measured on prod thread 019faada: ticker_classification wrote 4 todos at superstep
    // 5 and never called write_todos again, so the checkpoint still says 1-of-4 long
    // after the node finished successfully.
    const abandoned = [
      { content: 'Collect data', status: 'in_progress' },
      { content: 'Validate', status: 'pending' },
    ];
    const finished = [
      { content: 'Collect data', status: 'completed' },
      { content: 'Validate', status: 'done' },
    ];
    check('a finished node with unfinished todos is stale', isPlanStale(abandoned, 'done'));
    check('an errored node counts too', isPlanStale(abandoned, 'error'));
    // A running node mid-plan is not stale — it is simply not finished.
    check('a running node is never stale', !isPlanStale(abandoned, 'active'));
    check('a pending node is never stale', !isPlanStale(abandoned, 'pending'));
    check('a fully completed plan is not stale', !isPlanStale(finished, 'done'));
    check('both "completed" and "done" count as finished', !isPlanStale(finished, 'error'));
    check('an empty plan is not stale', !isPlanStale([], 'done'));
    check('a missing status counts as unfinished', isPlanStale([{}], 'done'));
  }

  console.log('\nthe deep-agent plan, and how it evolved');
  {
    const todosA = [{ content: 'Collect data', status: 'in_progress' }, { content: 'Classify', status: 'pending' }];
    const todosB = [{ content: 'Collect data', status: 'completed' }, { content: 'Classify', status: 'in_progress' }];
    const snaps = history(
      snapshot(3, null, [{ id: 'm', name: 'model' }], {}),
      snapshot(5, null, [{ id: 't', name: 'tools' }], { todos: todosA }),
      snapshot(6, null, [{ id: 'm2', name: 'model' }], { todos: todosA }), // unchanged
      snapshot(7, null, [{ id: 't2', name: 'tools' }], { todos: todosB }),
    );
    const plan = planFromSnapshots(snaps);
    // Successive states, not one final list — that is what lets the UI show the
    // plan the agent was actually working to at each point.
    check('only changes are recorded', plan.length === 2, `${plan.length}`);
    check('each change keeps its superstep', plan.map((p) => p.step).join(',') === '5,7');
    check('the final state is the latest', (plan[1].todos[0] as { status: string }).status === 'completed');
    check('a graph node has no plan', planFromSnapshots(history(snapshot(0, null, []))).length === 0);
  }

  console.log('\nthe transcript, split by the superstep that produced it');
  {
    const m = (i: number) => ({ type: 'ai', content: `m${i}` });
    const snaps = history(
      snapshot(2, null, [], { messages: [m(1)] }),
      snapshot(3, null, [], { messages: [m(1), m(2)] }),
      snapshot(4, null, [], { messages: [m(1), m(2)] }), // no growth
      snapshot(7, null, [], { messages: [m(1), m(2), m(3), m(4), m(5)] }),
    );
    const slices = transcriptByStep(snaps);
    // The growth of `values.messages` is the merge key that interleaves transcript
    // turns with child node runs and plan updates into ONE ordered timeline.
    check('a slice per superstep that added messages', slices.length === 3, `${slices.length}`);
    check('slices carry only the new messages', slices.map((s) => s.messages.length).join(',') === '1,1,3');
    check('slices keep their superstep', slices.map((s) => s.step).join(',') === '2,3,7');
    check('no slice for a superstep that added nothing', !slices.some((s) => s.step === 4));

    // Context summarisation rewrites the array. Reporting a negative slice would
    // crash the fold, so the baseline resets instead.
    const rewritten = transcriptByStep(history(
      snapshot(2, null, [], { messages: [m(1), m(2), m(3)] }),
      snapshot(3, null, [], { messages: [m(9)] }),
    ));
    check('a rewritten transcript resets rather than going negative', rewritten[1]?.messages.length === 1);
    check('a namespace with no messages yields no slices', transcriptByStep(history(snapshot(0, null, []))).length === 0);
  }

  console.log('\ndeep-agent sub-agents surface as named, drillable rows');
  {
    // A ToolNode task reports `checkpoint: null`, but the sub-agent it spawned
    // checkpoints under `<parent>|tools:<task id>`. Pairing the `task` call (which
    // names the sub-agent AND carries its brief) with its ToolMessage turns an
    // anonymous "Tools" step into a named row with an Input facet.
    const snaps = history(
      snapshot(1, null, [
        {
          id: 'm1',
          name: 'model',
          result: {
            messages: [aiCall('c1', 'task', { subagent_type: 'equity-fundamentals', description: 'Pull AAPL fundamentals' })],
          },
        },
      ]),
      snapshot(2, null, [{ id: 't1', name: 'tools', result: { messages: [{ ...toolResult('c1', 'report'), name: 'task' }] } }]),
      snapshot(3, null, [{ id: 'm2', name: 'model', result: { messages: [aiCall('c2', 'get_prices', { ticker: 'AAPL' })] } }]),
      snapshot(4, null, [{ id: 't2', name: 'tools', result: { messages: [toolResult('c2', '{...}')] } }]),
    );
    const lanes = lanesFromSnapshots(snaps, 'criteria_definition:u1');
    const nodes = lanes.flatMap((l) => l.nodes);
    check('one row per delegation', nodes.length === 1, nodes.map((n) => n.label).join(',') || '(none)');
    check('named after the sub-agent, not "Tools"', nodes[0]?.label === 'Equity fundamentals', nodes[0]?.label ?? '-');
    check('the brief becomes the Input facet', nodes[0]?.input === 'Pull AAPL fundamentals', nodes[0]?.input ?? '-');
    check(
      'namespace derived as <parent>|tools:<task id>',
      nodes[0]?.namespace === 'criteria_definition:u1|tools:t1',
      nodes[0]?.namespace ?? '-',
    );
    check('ordinary tool calls do not become rows', !nodes.some((n) => n.name === 'get_prices'));
    check('root has no parent prefix', lanesFromSnapshots(snaps)[0].nodes[0]?.namespace === 'tools:t1');

    // Three delegations in ONE superstep is a parallel sub-agent fan — measured on
    // prod thread 019faada, where it accounted for 16m11s of a 22m run.
    const fan = lanesFromSnapshots(
      history(
        snapshot(6, null, [
          {
            id: 'm',
            name: 'model',
            result: {
              messages: [
                { type: 'ai', content: '', tool_calls: [
                  { id: 'p1', name: 'task', args: { subagent_type: 'etf-index' } },
                  { id: 'p2', name: 'task', args: { subagent_type: 'economy-macro' } },
                ] },
              ],
            },
          },
        ]),
        snapshot(7, null, [
          { id: 'x1', name: 'tools', result: { messages: [{ ...toolResult('p1'), name: 'task' }] } },
          { id: 'x2', name: 'tools', result: { messages: [{ ...toolResult('p2'), name: 'task' }] } },
        ]),
      ),
    );
    check('parallel delegations share one lane', fan[0]?.parallel === true && fan[0].nodes.length === 2);
    check('and are named individually', fan[0].nodes.map((n) => n.label).sort().join(',') === 'Economy macro,Etf index');
  }

  console.log('\nagent-internal loop nodes are not execution steps');
  {
    const lanes = lanesFromSnapshots(
      history(snapshot(0, null, [
        { id: '1', name: 'model' },
        { id: '2', name: 'tools' },
        { id: '3', name: 'collect_data', ns: 'collect_data:u1' },
      ])),
    );
    const names = lanes.flatMap((l) => l.nodes).map((n) => n.name);
    // Without this filter every agent renders a "Model, Tools, Model, Tools…"
    // ladder. Measured: 11 of 14 supersteps in a real deep-agent namespace.
    check('model/tools filtered out', !names.includes('model') && !names.includes('tools'), names.join(','));
    check('real sub-agents survive', names.includes('collect_data'));
    check('a lane left empty by filtering is dropped', lanes.length === 1 && lanes[0].nodes.length === 1);
    check('middleware and sentinels filtered', isInternalNode('TodoListMiddleware.after_model') && isInternalNode('__start__'));
    check('a node merely CONTAINING "tools" survives', !isInternalNode('fetch_ohlcv') && !isInternalNode('use_tools_wisely'));
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

    const ok = runs.find((r) => r.tool === 'get_indicators');
    check('a successful call carries output_preview', !!ok?.output_preview, JSON.stringify(ok?.output_preview ?? null));
    check('args land in args_preview as JSON', ok?.args_preview === '{"ticker":"NVDA"}', ok?.args_preview ?? '-');
    const bad = runs.find((r) => r.tool === 'get_news');
    check('an errored call keeps error and leaves output empty', !!bad?.error && bad?.output_preview === '');

    // Cache metadata rides on the message, so the timeline needs no Store lookup
    // and no Python-compatible arg hashing to show a tool's full output.
    const withCache = toolRunsFromMessages([
      aiCall('h1', 'get_prices', { ticker: 'AAPL' }),
      { ...toolResult('h1', '{...}'), additional_kwargs: { cache: { hit: true, args_hash: 'abc123', byte_size: 2048 } } },
    ])[0];
    check('args_hash is read off the message', withCache?.args_hash === 'abc123', withCache?.args_hash ?? '-');
    check('cache_hit is read off the message', withCache?.cache_hit === true);
  }

  console.log('\ntranscripts come from the namespace\'s own messages channel');
  {
    // Read straight from `values.messages`. This briefly went through a
    // reconstruction from task writes because every deep agent reported an empty
    // channel — an upstream bug (langchain-ai/langgraph#8470), since fixed, where a
    // nested subgraph had no saver to replay its DeltaChannel.
    const snaps = history(
      snapshot(1, null, [{ id: 'p', name: '_InputPromptMiddleware.before_agent' }], {
        messages: [{ type: 'human', content: 'classify AAPL' }],
      }),
      snapshot(2, null, [{ id: 'm1', name: 'model' }], {
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
    check('the task delegation is visible as a tool call', toolRunsFromMessages(msgs).some((r) => r.tool === 'task'));
    check('an empty channel yields nothing', messagesFromSnapshots(history(snapshot(0, null, [], { messages: [] }))).length === 0);
  }

  console.log('\ntrading_decision — debate output shape (prod fixture)');
  {
    const values = load('trading');
    const msgs = values.investment_debate_messages;
    check('debate messages are a bare array', Array.isArray(msgs), `${(msgs as unknown[])?.length} turns`);
    const isMsgList =
      Array.isArray(msgs) &&
      msgs.length > 0 &&
      msgs.every((m) => !!m && typeof m === 'object' && ('type' in m || 'role' in m));
    check('array is recognisable as serialized messages', isMsgList);
  }

  console.log('\nthe landing hero yields to a run that produced nothing');
  {
    // Regression guard for the bug where an errored/stopped run fell back to the
    // composer and hid its own RunErrorCard. The old predicate only consulted
    // the mount-time `pinnedThreadId`, so every case below except the first
    // wrongly reported "show the hero".
    const fresh = { busy: false, hasOutput: false, hydrating: false };
    check('a genuinely fresh screen shows the hero', showsLandingHero(fresh));
    check(
      'a submitted run that ERRORED keeps the run view',
      !showsLandingHero({ ...fresh, liveThreadId: 't1' }),
    );
    check(
      'a run stopped by the user keeps the run view',
      !showsLandingHero({ ...fresh, liveThreadId: 't1', busy: false }),
    );
    check('a running run keeps the run view', !showsLandingHero({ ...fresh, busy: true }));
    check(
      'a finished run with output keeps the run view',
      !showsLandingHero({ ...fresh, hasOutput: true }),
    );
    check(
      'a reopened thread still hydrating keeps the run view',
      !showsLandingHero({ ...fresh, pinnedThreadId: 't1', hydrating: true }),
    );
    check(
      'a reopened thread keeps the run view',
      !showsLandingHero({ ...fresh, pinnedThreadId: 't1' }),
    );
  }

  console.log('\nedge cases degrade cleanly');
  {
    check('no snapshots, no crash', lanesFromSnapshots([]).length === 0);
    check('snapshots with no tasks, no crash', lanesFromSnapshots([snapshot(0, null, [])]).length === 0);
    check('taskWrite unwraps $writes', taskWrite({ k: { $writes: [[{ v: 1 }]] } }, 'k') !== undefined);
    check('taskWrite tolerates a missing channel', taskWrite({}, 'nope') === undefined);
    check('a missing timestamp yields no duration', durationBetween(undefined, '2026-01-01T00:00:00Z') === undefined);
    check('a backwards clock yields no duration', durationBetween('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z') === undefined);
    check('sub-second durations stay honest', formatDuration(340) === '340ms');
    check('a missing duration formats to nothing', formatDuration(undefined) === undefined);
    // A repeated task must not become a second lane.
    const repeated = lanesFromSnapshots(history(
      snapshot(0, null, [{ id: 'r', name: 'analyst', ns: 'analyst:u1' }]),
      snapshot(1, null, [{ id: 'r', name: 'analyst', ns: 'analyst:u1' }]),
    ));
    check('a task repeated across supersteps stays one node', repeated.flatMap((l) => l.nodes).length === 1);
  }

  console.log('\nthe timeline skeleton is generic — an unknown graph still gets a real shape');
  {
    // The loading skeleton renders `pendingNodes(planFromGraph(graph), ∅)` — the run's actual
    // steps rather than three anonymous bars. That is only honest if it works for a graph the
    // app has never seen, so this uses invented node names on purpose. If someone later reaches
    // for `AgentDef.stages` here, registered graphs would keep working and this would fail.
    const unknown: AssistantGraph = {
      nodes: [
        { id: '__start__', data: '__start__' },
        { id: 'quantum_flux_probe', data: 'quantum_flux_probe' },
        { id: 'ReducerMiddleware.before', data: 'ReducerMiddleware.before' },
        { id: 'zeta_reconciliation', data: 'zeta_reconciliation' },
        { id: 'orphaned_epilogue', data: 'orphaned_epilogue' },
        { id: '__end__', data: '__end__' },
      ],
      edges: [
        { source: '__start__', target: 'quantum_flux_probe' },
        { source: 'quantum_flux_probe', target: 'zeta_reconciliation' },
        { source: 'zeta_reconciliation', target: '__end__' },
      ],
    } as unknown as AssistantGraph;

    const plan = planFromGraph(unknown);
    const names = plan.map((s) => s.name);
    check('unseen graph still yields a plan', plan.length === 3, names.join(','));
    check('sentinels and middleware are filtered', !names.some((n) => isInternalNode(n)));
    check(
      'unknown node ids get readable labels',
      plan[0]?.label === 'Quantum flux probe',
      `${plan[0]?.label}`,
    );
    check('unreachable nodes still appear, sorted last', names[names.length - 1] === 'orphaned_epilogue');

    // With no lanes yet, nothing has executed — so the skeleton shows every step, as pending.
    const skeleton = pendingNodes(plan, new Set());
    check('skeleton row per planned step', skeleton.length === plan.length, `${skeleton.length}`);
    check('skeleton rows are all pending', skeleton.every((n) => n.status === 'pending'));
    check('skeleton rows carry labels, not blanks', skeleton.every((n) => n.label.trim().length > 0));
    // Pending rows must not be expandable, or the skeleton would fire history fetches.
    check('skeleton rows have no namespace to fetch', skeleton.every((n) => !n.namespace));
  }

  console.log('\nrendered text is bounded, so one bad payload cannot abort the app');
  {
    // The real shape that took a Pixel down: ~196 KB on a SINGLE line, so there
    // is no newline to cut on. This is the case a boundary-seeking slice must
    // still bound rather than give up and return everything.
    const degenerate = `[{'type': 'reasoning', 'reasoning': 'We need to produce a.${',,,\n'.repeat(0)}${'x'.repeat(196_000)}`;
    check(
      'a 196KB single-line turn is bounded',
      sliceAtBoundary(degenerate).length <= BOUND,
      `${sliceAtBoundary(degenerate).length} chars`,
    );
    // 753 KB across 15 turns is what `risk_debate_messages` actually held.
    const turn = 'y'.repeat(250_000);
    check('a 250KB turn is bounded', sliceAtBoundary(turn).length <= BOUND);

    // Content a graph legitimately produces must be untouched — a bound that
    // truncates ordinary reports would be worse than the bug.
    const report = '## Analysis\n\n' + 'A long but reasonable analyst paragraph. '.repeat(50);
    check('a normal report is returned verbatim', sliceAtBoundary(report) === report, `${report.length} chars`);
    check('an empty string survives', sliceAtBoundary('') === '');

    // Cutting mid-fence/mid-table renders as broken markup, so the slice prefers
    // a line boundary when one is available within budget.
    const lines = ('sensible markdown line\n'.repeat(2000));
    const cut = sliceAtBoundary(lines);
    check('a multi-line payload cuts on a line boundary', !cut.endsWith('sensible markdown li') && cut.length <= BOUND);
    check('the boundary cut keeps most of the budget', cut.length > BOUND * 0.5, `${cut.length} of ${BOUND}`);

    // "Show more" must actually reveal more, or the reveal is a dead end.
    check(
      'raising the limit reveals strictly more',
      sliceAtBoundary(turn, BOUND * 2).length > sliceAtBoundary(turn, BOUND).length,
    );
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
