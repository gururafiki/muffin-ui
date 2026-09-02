/**
 * Sankey geometry — d3-sankey, with the semantic column forced and no React.
 *
 * PURE ON PURPOSE, like `income-flow.ts`: the layout is where the one non-obvious failure lives, so
 * it has to be drivable by `tsx`. See `scripts/income-flow-check.ts`.
 *
 * TWO THINGS d3-sankey DOES THAT THIS HAS TO UNDO:
 *
 * 1. **It orders columns by graph structure**, and this chart's order is semantic — revenue always
 *    left of gross profit, whether or not a filer discloses segments. `nodeAlign` is the supported
 *    hook for that: it returns the layer index for a node, so returning our own column pins it.
 *
 * 2. **It overwrites `node.depth`.** d3 computes `depth`/`height` from the links BEFORE calling
 *    `align`, so a field named `depth` is already clobbered by the time alignment reads it. The
 *    semantic column is therefore copied to `column` first — a name d3 does not touch. Measured:
 *    for the shapes `buildFlow` produces, d3's computed depth happens to equal the semantic column,
 *    so this copy is DEFENSIVE rather than currently load-bearing, and a mutation reading `depth`
 *    instead is a genuine no-op. It stays because the coincidence is a property of today's P&L
 *    graph, not of the code — a stage added out of order would break it silently.
 *
 * AND THE COLUMNS MUST BE MADE CONTIGUOUS, WHICH IS NOT COSMETIC — IT IS A CRASH.
 * `computeNodeBreadths` builds `columns` as an array indexed by layer and then reads `c.length` on
 * every entry, so a layer nobody occupies is a hole and it throws
 * `Cannot read properties of undefined (reading 'length')`. A company with no segments starts at
 * column 1 with column 0 empty — and that is 8,949 of the 9,015 securities this chart can draw, so
 * the sparse case is the COMMON one, not the edge. Normalising the used columns to 0..k-1 keeps the
 * order (the thing that is semantic) and drops the holes (the thing that is an artefact).
 */
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';

import type { FlowLink, FlowNode } from '../income-flow';

export interface PlacedNode extends FlowNode {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /**
   * The column the node was ACTUALLY DRAWN IN — the rank of its x position, read back off the
   * layout rather than echoed from the input. Reading back the value we passed in produced a guard
   * that could not fail: dropping `nodeAlign` altogether moved cost of sales three columns right
   * and the assertion still passed, because it was inspecting our own request.
   */
  column: number;
}

export interface PlacedLink {
  from: string;
  to: string;
  value: number;
  /** The ribbon, as an SVG path. */
  path: string;
  width: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  nodeWidth?: number;
  nodePadding?: number;
}

export interface Layout {
  nodes: PlacedNode[];
  links: PlacedLink[];
  columns: number;
}

const EMPTY: Layout = { nodes: [], links: [], columns: 0 };

/** Place a flow. Returns an empty layout for anything undrawable rather than throwing. */
export function layoutFlow(
  flowNodes: FlowNode[],
  flowLinks: FlowLink[],
  { width, height, nodeWidth = 12, nodePadding = 12 }: LayoutOptions,
): Layout {
  if (flowNodes.length === 0 || width <= 0 || height <= 0) return EMPTY;

  // Only links whose BOTH ends were drawn. A stage the flow declined to draw (a loss-making
  // operating income, say) leaves its link behind, and d3 throws `missing: <id>` on a dangling one.
  const known = new Set(flowNodes.map((n) => n.key));
  const links = flowLinks.filter((l) => known.has(l.from) && known.has(l.to) && l.value > 0);

  const used = [...new Set(flowNodes.map((n) => n.depth))].sort((a, b) => a - b);
  const columnOf = (depth: number) => used.indexOf(depth);

  // Nothing to draw. Measured: d3 does NOT throw on a single column — this is about the picture,
  // not about safety. A Sankey is its ribbons, so a column of boxes with nothing flowing between
  // them is a chart that says less than the table above it.
  if (used.length < 2 || links.length === 0) return EMPTY;

  // d3 MUTATES what it is given, so it gets copies — the caller's flow is React state.
  const input = {
    nodes: flowNodes.map((n) => ({ ...n, column: columnOf(n.depth) })),
    links: links.map((l) => ({ source: l.from, target: l.to, value: l.value })),
  };

  let graph;
  try {
    graph = sankey<any, any>()
      .nodeId((d: any) => d.key)
      .nodeAlign((d: any) => d.column)
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .extent([
        [0, 0],
        [width, height],
      ])(input as any);
  } catch {
    // A layout that cannot be computed must not take the stock page down with it.
    return EMPTY;
  }

  const linkPath = sankeyLinkHorizontal();
  const xs = [...new Set((graph.nodes as any[]).map((n) => Math.round(n.x0)))].sort((a, b) => a - b);
  return {
    columns: used.length,
    nodes: (graph.nodes as any[]).map((n) => ({
      key: n.key, label: n.label, value: n.value, tone: n.tone, derived: n.derived,
      depth: n.depth, yoy: n.yoy, column: xs.indexOf(Math.round(n.x0)),
      x0: n.x0, x1: n.x1, y0: n.y0, y1: n.y1,
    })),
    links: (graph.links as any[])
      .map((l) => ({
        from: l.source.key as string,
        to: l.target.key as string,
        value: l.value as number,
        path: String(linkPath(l as any) ?? ''),
        width: l.width as number,
      }))
      .filter((l) => l.path.length > 0 && Number.isFinite(l.width) && l.width > 0),
  };
}
