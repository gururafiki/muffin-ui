/**
 * The income statement as a flow — the arithmetic, with no React and no network.
 *
 * SEPARATE FROM THE HOOK ON PURPOSE. A module that imports react-native cannot be loaded by `tsx`,
 * so anything worth asserting has to live outside the component — the same split `money.ts` and
 * `macro-format.ts` already use. What is asserted here is that the diagram's numbers ADD UP, which
 * is the one property a flow chart cannot fake; `scripts/income-flow-check.ts` drives it against
 * Amazon's real FY2025 figures.
 *
 * TWO NODES ARE DERIVED, AND THEY SAY SO. `cost_of_revenue` is held for only 1,559 rows across the
 * universe while `gross_profit` is held for 32,667, so cost of sales is `revenue − gross_profit`;
 * operating costs is `gross_profit − operating_income` for the same reason. Both are produced ONLY
 * when both inputs exist — a missing input means the stage is not drawn, never that it is zero.
 *
 * AND THE RESIDUAL IS KEPT. `pretax − tax − net` is 0.55bn for Amazon FY2025 and that is real:
 * non-controlling interests and equity-method results live there. A flow diagram whose outputs do
 * not sum to its input is lying about arithmetic, so the remainder becomes its own node rather than
 * being quietly dropped.
 */

/** One period's metrics, narrowed to a single `as_of`. */
export type MetricsAt = Map<string, number>;

/** The metric codes this chart draws. Anything else in the catalogue is not part of the waterfall. */
export const FLOW_METRICS = [
  'revenue',
  'gross_profit',
  'operating_income',
  'pretax_income',
  'income_tax',
  'net_income',
] as const;

export interface FlowNode {
  key: string;
  label: string;
  value: number;
  /** `revenue` for the trunk, `profit` for anything retained, `cost` for anything consumed. */
  tone: 'revenue' | 'profit' | 'cost';
  /** True where the figure is a subtraction rather than a reported line; shown as a footnote. */
  derived: boolean;
  /** Which column of the waterfall this sits in. Semantic, never computed — see `sankey.tsx`. */
  depth: number;
  /** Fractional change against the prior annual period, or null when there is no prior. */
  yoy: number | null;
}

export interface FlowLink {
  from: string;
  to: string;
  value: number;
}

export interface Flow {
  nodes: FlowNode[];
  links: FlowLink[];
}

const change = (now: number | null, prior: number | null): number | null =>
  now === null || prior === null || prior === 0 ? null : (now - prior) / Math.abs(prior);

const minus = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : a - b;

/**
 * Build the waterfall from one period's metrics, with the prior period only for Y/Y.
 *
 * Returns an empty flow when there is no revenue: without the trunk there is nothing for the other
 * nodes to flow from, and a diagram of disconnected boxes is worse than no diagram.
 */
export function buildFlow(now: MetricsAt, prior: MetricsAt = new Map()): Flow {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];

  const g = (k: string): number | null => now.get(k) ?? null;
  const p = (k: string): number | null => prior.get(k) ?? null;

  // A NODE MUST BE A POSITIVE MAGNITUDE. A Sankey's ribbon width is a quantity, so a negative or
  // zero value has no width to draw — a loss-making company's operating income is handled by the
  // stage simply not being drawn, rather than by an inverted ribbon nobody can read.
  const add = (
    key: string, label: string, value: number | null,
    tone: FlowNode['tone'], depth: number, yoy: number | null, derived = false,
  ): boolean => {
    if (value === null || !Number.isFinite(value) || value <= 0) return false;
    nodes.push({ key, label, value, tone, derived, depth, yoy });
    return true;
  };

  const revenue = g('revenue');
  if (!add('revenue', 'Revenue', revenue, 'revenue', 1, change(revenue, p('revenue')))) {
    return { nodes: [], links: [] };
  }

  // Stage 1 — revenue splits into gross profit and cost of sales.
  const gross = g('gross_profit');
  const costOfSales = minus(revenue, gross);
  if (add('gross_profit', 'Gross profit', gross, 'profit', 2, change(gross, p('gross_profit')))) {
    links.push({ from: 'revenue', to: 'gross_profit', value: gross as number });
  }
  if (add('cost_of_sales', 'Cost of sales', costOfSales, 'cost', 2,
          change(costOfSales, minus(p('revenue'), p('gross_profit'))), true)) {
    links.push({ from: 'revenue', to: 'cost_of_sales', value: costOfSales as number });
  }

  // Stage 2 — gross profit splits into operating income and operating costs. Anchored on gross
  // profit, so a filer that reports no gross profit gets no stage rather than a wrong one.
  const operating = g('operating_income');
  const opCosts = minus(gross, operating);
  const hasGross = nodes.some((n) => n.key === 'gross_profit');
  if (hasGross &&
      add('operating_income', 'Operating income', operating, 'profit', 3,
          change(operating, p('operating_income')))) {
    links.push({ from: 'gross_profit', to: 'operating_income', value: operating as number });
  }
  if (hasGross &&
      add('operating_costs', 'Operating costs', opCosts, 'cost', 3,
          change(opCosts, minus(p('gross_profit'), p('operating_income'))), true)) {
    links.push({ from: 'gross_profit', to: 'operating_costs', value: opCosts as number });
  }

  // Stage 3 — operating income becomes PRETAX income, and the difference is a node of its own.
  //
  // THIS STAGE EXISTS BECAUSE THE TWO FIGURES DIFFER AND THE GAP HAS TO COME FROM SOMEWHERE. For
  // Amazon FY2025 operating income is 80.0bn and pretax is 97.3bn — 17.3bn of interest and other
  // non-operating income. Collapsing the stage and splitting pretax straight out of the
  // operating-income node makes 17.3bn appear from nowhere, and d3-sankey then quietly relabels
  // that node with the larger of its two sides: the deployed chart read "Operating income
  // $97.31B", which is a real number belonging to a different line. A Sankey is a claim that what
  // flows in equals what flows out, so an unbalanced node is not a cosmetic problem.
  if (!nodes.some((n) => n.key === 'operating_income')) return { nodes, links };
  const net = g('net_income');
  const tax = g('income_tax');
  const pretax = g('pretax_income') ?? operating;

  if (!add('pretax_income', 'Pretax income', pretax, 'profit', 4, change(pretax, p('pretax_income') ?? p('operating_income')))) {
    return { nodes, links };
  }
  const carried = Math.min(operating as number, pretax as number);
  links.push({ from: 'operating_income', to: 'pretax_income', value: carried });

  const nonOperating = (pretax as number) - (operating as number);
  if (nonOperating > 0) {
    // Income earned outside operations — interest, investments, equity-method results. A SOURCE
    // node: it enters the statement here rather than flowing from anything to its left.
    if (add('non_operating', 'Other income', nonOperating, 'profit', 3, null, true)) {
      links.push({ from: 'non_operating', to: 'pretax_income', value: nonOperating });
    }
  } else if (nonOperating < 0) {
    // Interest and other costs, consumed out of operating income before tax.
    if (add('non_operating', 'Interest & other', -nonOperating, 'cost', 4, null, true)) {
      links.push({ from: 'operating_income', to: 'non_operating', value: -nonOperating });
    }
  }

  // Stage 4 — pretax splits into what is kept, what is taxed, and the remainder.
  if (add('net_income', 'Net income', net, 'profit', 5, change(net, p('net_income')))) {
    links.push({ from: 'pretax_income', to: 'net_income', value: net as number });
  }
  if (add('income_tax', 'Income tax', tax, 'cost', 5, change(tax, p('income_tax')))) {
    links.push({ from: 'pretax_income', to: 'income_tax', value: tax as number });
  }

  // The remainder, so the stage's outputs sum to its input. Signed: a company whose minority
  // interests are a net GAIN has a negative residual, which is coloured as one. Amazon FY2025 is
  // 0.55bn of non-controlling interests and equity-method results — small, real, and a diagram
  // that dropped it would not add up.
  const residual = net === null || tax === null ? null : (pretax as number) - net - tax;
  if (residual !== null && Math.abs(residual) > 0 &&
      add('other', residual < 0 ? 'Other income, net' : 'Other', Math.abs(residual),
          residual < 0 ? 'profit' : 'cost', 5, null, true)) {
    links.push({ from: 'pretax_income', to: 'other', value: Math.abs(residual) });
  }

  return { nodes, links };
}

/**
 * Revenue streams flowing INTO the trunk — the left half, where a filer discloses segments.
 *
 * THE STREAMS ARE CHECKED AGAINST THE COMPANY'S OWN REVENUE, AND OVER- AND UNDER-COVERAGE ARE
 * DIFFERENT FACTS. A Sankey's whole claim is that what flows in equals what flows out, so a split
 * that does not match the trunk cannot simply be drawn beside it.
 *
 * - **Over the trunk is a DEFECT** — a member counted twice, or an axis carrying two overlapping
 *   splits. Measured 2026-09-02 before the serving view was fixed, Apple's streams came to 143% of
 *   its revenue and Shell's to 450%. Nothing is drawn: a diagram that visibly does not add up is
 *   worse than one section fewer.
 * - **Under the trunk is the FILER'S CHOICE** and perfectly legitimate — Novo Nordisk discloses
 *   geographies covering 37% of revenue. The remainder becomes an explicit "Not disclosed" stream,
 *   so the ribbons still sum to the trunk and the reader can see how much was left unsplit.
 *
 * The tolerance is 1%: rounding in a filing is cents on billions (Amazon reconciles to 0.00% and
 * AT&T to 0.30%), while every real defect measured here was off by tens of percent or more.
 *
 * `trunk` is the revenue this company reported. Passing 0 or null draws nothing — without a trunk
 * there is no claim to check the streams against, and an unchecked split is exactly what this
 * guard exists to prevent. Measured: deleting the explicit null check changes NOTHING today,
 * because `null * 1.01` is 0 and the over-coverage test then rejects every split on its own. It
 * stays because that is an implicit coercion holding up a correctness rule — the same falsy-NULL
 * shape that once made the currency gate decline to fire on the one security it was built for —
 * and a reader should not have to find it to know a null trunk is handled.
 */
export function streamsInto(
  lines: { label: string; revenue: number | null }[],
  trunk: number | null,
): { nodes: FlowNode[]; links: FlowLink[] } {
  if (trunk === null || !Number.isFinite(trunk) || trunk <= 0) return { nodes: [], links: [] };

  const usable = lines.filter(
    (l): l is { label: string; revenue: number } =>
      l.revenue !== null && Number.isFinite(l.revenue) && l.revenue > 0,
  );
  if (usable.length === 0) return { nodes: [], links: [] };

  const disclosed = usable.reduce((a, l) => a + l.revenue, 0);
  // Over the trunk: the split contradicts the company's own revenue. Draw none of it.
  if (disclosed > trunk * 1.01) return { nodes: [], links: [] };

  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  for (const [i, l] of usable.entries()) {
    const key = `stream:${i}`;
    nodes.push({ key, label: l.label, value: l.revenue, tone: 'revenue', derived: false, depth: 0, yoy: null });
    links.push({ from: key, to: 'revenue', value: l.revenue });
  }

  // Under the trunk: name the gap rather than letting the ribbons quietly fall short of it.
  const undisclosed = trunk - disclosed;
  if (undisclosed > trunk * 0.01) {
    nodes.push({
      key: 'stream:undisclosed', label: 'Not disclosed', value: undisclosed,
      tone: 'revenue', derived: true, depth: 0, yoy: null,
    });
    links.push({ from: 'stream:undisclosed', to: 'revenue', value: undisclosed });
  }

  return { nodes, links };
}
