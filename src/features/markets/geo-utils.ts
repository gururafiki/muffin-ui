/**
 * Runtime geometry helpers over world-geo.ts — compute a focused viewBox for a
 * set of countries (used to zoom the map to a region/group).
 */
import { WORLD_GEO, WORLD_VIEWBOX } from './world-geo';

interface Box { x0: number; y0: number; x1: number; y1: number }

const GEO_BY_ISO = new Map(WORLD_GEO.map((c) => [c.iso, c]));
const bboxCache = new Map<string, Box>();

export const nameForIso = (iso: string): string => GEO_BY_ISO.get(iso)?.name ?? iso;

function countryBox(iso: string): Box | undefined {
  if (bboxCache.has(iso)) return bboxCache.get(iso);
  const c = GEO_BY_ISO.get(iso);
  if (!c) return undefined;
  const nums = c.d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return undefined;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = +nums[i], y = +nums[i + 1];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const box = { x0, y0, x1, y1 };
  bboxCache.set(iso, box);
  return box;
}

/**
 * A padded viewBox framing the given countries. Falls back to the whole world.
 * `pad` is a fraction of the box's larger dimension.
 */
export function viewBoxForIsos(isos: string[], pad = 0.16): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const iso of isos) {
    const b = countryBox(iso);
    if (!b) continue;
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  if (!isFinite(x0)) return WORLD_VIEWBOX;
  const p = Math.max((x1 - x0), (y1 - y0)) * pad + 8;
  const x = Math.max(0, x0 - p);
  const y = Math.max(0, y0 - p);
  const w = Math.min(2000, x1 + p) - x;
  const h = Math.min(857, y1 + p) - y;
  return `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
}
