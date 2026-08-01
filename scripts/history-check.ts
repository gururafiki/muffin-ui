/**
 * Proves the run timeline is reconstructable from the LangGraph API alone, against the
 * live deployment. This is the gate on the whole "UI-only, works for any graph" premise:
 * no muffin-agent change, no Store side-reads, no per-graph table.
 *
 *   CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… npx tsx scripts/history-check.ts
 *
 * Complements `scripts/run-timeline-check.ts`, which exercises the same modules offline
 * on synthetic snapshots. This one confirms the API really returns the shapes those
 * fixtures encode — `metadata.step`, `created_at`, `next`, `task.result` channel keys,
 * and a DAG from `assistants.getGraph`.
 */
import { Client } from '@langchain/langgraph-sdk';

import { planFromGraph } from '../src/lib/agent/run-graph';
import { formatDuration, type Lane } from '../src/lib/agent/run-node';
import {
  fetchNamespace,
  lanesFromSnapshots,
  messagesFromSnapshots,
  pendingFromSnapshots,
  planFromSnapshots,
  transcriptByStep,
} from '../src/lib/agent/run-history';

const API = process.env.MUFFIN_API ?? 'https://muffin-api.rafiki.guru';
const THREADS = {
  trading: '019f81a0-0ccd-7301-9710-e4ccea8ddb95',
  /** The 2026-07-28 criteria run measured in the design: 8 supersteps, a 2-wide
   * parallel lane at step 2 and a 10-wide Send fan-out at step 4. */
  criteria: '019faada-a9a8-7470-b490-48d5cc41f532',
  council: '019f901f-1cda-747d-8c09-b7eb2612b64a',
};
const GRAPHS = ['criteria_analysis', 'trading_decision', 'council', 'research', 'stock_evaluation'];

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

function describe(lanes: Lane[]): string {
  return lanes
    .map((l) => `${l.step}:${l.nodes.length}${l.parallel ? '∥' : ''}`)
    .join(' ');
}

async function main(): Promise<void> {
  const c = client();

  console.log('\nassistants.getGraph — the compiled DAG, for every registered graph');
  for (const graphId of GRAPHS) {
    const [graph, ms] = await timed(() => c.assistants.getGraph(graphId).catch(() => null));
    const plan = planFromGraph(graph ?? undefined);
    console.log(`    ${graphId.padEnd(20)} ${ms}ms · ${graph?.nodes.length ?? 0} nodes → ${plan.length} planned steps`);
    check(`${graphId}: graph served`, !!graph);
    check(`${graphId}: no plumbing in the plan`, !plan.some((s) => /Middleware|__start__|__end__/.test(s.name)));
    if (graphId === 'stock_evaluation') {
      // A pure deep agent has NO graph-level plan and must not fake one: its only
      // top-level nodes are `model`, `tools` and middleware hooks, every one of them
      // plumbing. Its real plan is `values.todos`, read per namespace. An empty plan
      // here is the correct answer, and asserting it stops a future "helpful"
      // relaxation of the internal-node filter from leaking a "Model, Tools" ladder
      // into the timeline.
      check(`${graphId}: a deep agent has no static plan`, plan.length === 0, `${plan.length}`);
    } else {
      check(`${graphId}: plan is non-empty`, plan.length > 0, plan.slice(0, 4).map((s) => s.name).join(','));
    }
  }

  console.log('\ncriteria_analysis — supersteps really do encode parallelism');
  const [critSnaps, critMs] = await timed(() => fetchNamespace(c, THREADS.criteria));
  const critLanes = lanesFromSnapshots(critSnaps);
  console.log(`    ${critMs}ms · ${critSnaps.length} snapshots → lanes ${describe(critLanes)}`);
  for (const l of critLanes) {
    console.log(
      `      step ${String(l.step).padStart(2)} ${(formatDuration(l.durationMs) ?? '—').padStart(8)}  ` +
        `${l.parallel ? `∥ ${l.nodes.length}× ` : '   '}${l.nodes.map((n) => n.label).slice(0, 3).join(', ')}`,
    );
  }
  check('lanes were built', critLanes.length > 0, `${critLanes.length}`);
  // The measured shape. If LangGraph ever stops reporting metadata.step, the
  // timeline silently collapses to one lane per node — this is what catches that.
  const parallelLanes = critLanes.filter((l) => l.parallel);
  check('at least one parallel lane exists', parallelLanes.length > 0, `${parallelLanes.length}`);
  check('the Send fan-out lands in ONE lane', critLanes.some((l) => l.nodes.length >= 8), describe(critLanes));
  check('fan-out members label themselves distinctly', (() => {
    const fan = critLanes.find((l) => l.nodes.length >= 8);
    return !!fan && new Set(fan.nodes.map((n) => n.label)).size === fan.nodes.length;
  })());
  // Regression: label-from-payload must apply ONLY to fan-out members. Run against
  // every node it renamed `merge_criteria` to "Revenue Growth (3Y CAGR)" — the first
  // criterion in the list it merely collected.
  check('a solo node keeps its own node name', (() => {
    const solo = critLanes.flatMap((l) => (l.parallel ? [] : l.nodes)).find((n) => n.name === 'merge_criteria');
    return !solo || solo.label === 'Merge criteria';
  })(), critLanes.flatMap((l) => (l.parallel ? [] : l.nodes)).find((n) => n.name === 'merge_criteria')?.label ?? 'n/a');
  check('durations are real', critLanes.some((l) => (l.durationMs ?? 0) > 0));
  check('compiled subgraphs are drillable', critLanes.flatMap((l) => l.nodes).some((n) => n.namespace));
  check('plain function nodes are leaves', critLanes.flatMap((l) => l.nodes).some((n) => !n.namespace));
  check('no middleware plumbing leaked in', !critLanes.flatMap((l) => l.nodes).some((n) => /middleware/i.test(n.name)));
  check('a finished run has nothing pending', pendingFromSnapshots(critSnaps).length === 0);
  check('single-channel writes record their channel', critLanes.flatMap((l) => l.nodes).some((n) => !!n.outputChannel));

  console.log('\ncriteria_analysis — a deep-agent namespace carries plan + transcript');
  const deep = critLanes.flatMap((l) => l.nodes).find((n) => n.name === 'ticker_classification');
  if (!deep?.namespace) {
    check('ticker_classification namespace present', false);
  } else {
    const [snaps, ms] = await timed(() => fetchNamespace(c, THREADS.criteria, deep.namespace));
    const plan = planFromSnapshots(snaps);
    const slices = transcriptByStep(snaps);
    const lanes = lanesFromSnapshots(snaps, deep.namespace);
    console.log(
      `    ${ms}ms · ${snaps.length} snapshots · ${plan.length} plan revisions · ` +
        `${slices.length} transcript slices · lanes ${describe(lanes)}`,
    );
    // Both fork pins in one assertion: a non-empty transcript needs langgraph#8470,
    // and drillable `|tools:` children need the deepagents fork.
    check('the deep agent has a plan', plan.length > 0, `${plan.length} revisions`);
    check('todos carry content + status', (() => {
      const t = plan.at(-1)?.todos?.[0] as { content?: string; status?: string } | undefined;
      return !!t?.content && !!t?.status;
    })());
    check('the transcript splits across supersteps', slices.length > 1, `${slices.length}`);
    check('transcript slices are non-empty', slices.every((s) => s.messages.length > 0));
    check('sub-agent delegations became rows', lanes.flatMap((l) => l.nodes).length > 0, describe(lanes));
    check('and they are named, not "Tools"', !lanes.flatMap((l) => l.nodes).some((n) => n.name === 'tools'));
  }

  console.log('\ntrading_decision — the four analysts are one parallel lane');
  const [tradeSnaps, tradeMs] = await timed(() => fetchNamespace(c, THREADS.trading));
  const tradeLanes = lanesFromSnapshots(tradeSnaps);
  console.log(`    ${tradeMs}ms · lanes ${describe(tradeLanes)}`);
  const analystLane = tradeLanes.find((l) => l.nodes.some((n) => /analyst/i.test(n.name)));
  check('an analyst lane exists', !!analystLane);
  check('the analysts ran in parallel', (analystLane?.nodes.length ?? 0) > 1, `${analystLane?.nodes.length ?? 0}`);
  check('both debates are drillable', tradeLanes.flatMap((l) => l.nodes).filter((n) => /debate/i.test(n.name) && n.namespace).length === 2);
  check('plain LLM nodes are leaves', tradeLanes.flatMap((l) => l.nodes).some((n) => /judge|trader|portfolio/i.test(n.name) && !n.namespace));

  const analyst = tradeLanes.flatMap((l) => l.nodes).find((n) => /market_analyst/.test(n.name));
  if (analyst?.namespace) {
    const [snaps, ms] = await timed(() => fetchNamespace(c, THREADS.trading, analyst.namespace));
    const msgs = messagesFromSnapshots(snaps) as { type?: string; tool_calls?: unknown[] }[];
    const toolCalls = msgs.flatMap((m) => m.tool_calls ?? []);
    console.log(`    market_analyst: ${ms}ms · ${msgs.length} messages · ${toolCalls.length} tool calls`);
    check('the analyst transcript is present', msgs.length > 0, `${msgs.length}`);
    check('its tool calls are present', toolCalls.length > 0, `${toolCalls.length}`);
  }

  console.log('\ncouncil — 13 personas fan out in a single superstep');
  const [councilSnaps, councilMs] = await timed(() => fetchNamespace(c, THREADS.council));
  const councilLanes = lanesFromSnapshots(councilSnaps);
  const widest = councilLanes.reduce((a, l) => Math.max(a, l.nodes.length), 0);
  console.log(`    ${councilMs}ms · lanes ${describe(councilLanes)} · widest ${widest}`);
  check('the persona fan is one lane', widest >= 10, `widest lane ${widest}`);
  check('personas are drillable', councilLanes.flatMap((l) => l.nodes).filter((n) => n.namespace).length >= 10);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
