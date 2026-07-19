/**
 * Time-series detection for tool outputs — pure data logic, no React/RN
 * imports, so it can be exercised standalone.
 *
 * Recognises the shapes the OpenBB MCP tools return (price history,
 * indicators): a JSON array of records — optionally wrapped in
 * `{ results: [...] }` / `{ data: [...] }` — where each record has one
 * date-like field plus numeric fields. Produces chart-ready line series
 * (plus a volume bar series when present) for `TimeSeriesChart`.
 */
import { titleCase } from '@/lib/format';

export interface SeriesPoint {
  /** Epoch millis. */
  x: number;
  y: number;
}

export interface TimeSeries {
  lines: { label: string; points: SeriesPoint[] }[];
  /** Volume-like series rendered as bars under the lines. */
  bars?: { label: string; points: SeriesPoint[] };
  startLabel: string;
  endLabel: string;
}

/** Payloads larger than this are never parsed for charting. */
const MAX_PARSE_CHARS = 2_000_000;
const MIN_POINTS = 5;
const MAX_LINES = 3;

const DATE_KEYS = ['date', 'datetime', 'timestamp', 'time', 'period'];
/** Preferred single line when present (price history → close). */
const PREFERRED_KEYS = ['close', 'adj_close', 'adjusted_close', 'value', 'price'];
const BAR_KEYS = ['volume'];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

type Row = Record<string, unknown>;

function toEpoch(v: unknown): number | undefined {
  if (typeof v === 'string' && ISO_DATE_RE.test(v)) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12) return v; // epoch millis
    if (v > 1e9) return v * 1000; // epoch seconds
  }
  return undefined;
}

function isRow(v: unknown): v is Row {
  return typeof v === 'object' && v != null && !Array.isArray(v);
}

/** Unwrap the OpenBB `{ results: [...] }` (or `data`) envelope. */
function toRows(value: unknown): Row[] | undefined {
  let v = value;
  if (isRow(v)) v = (v.results ?? v.data) as unknown;
  if (!Array.isArray(v) || v.length < MIN_POINTS) return undefined;
  return v.every(isRow) ? (v as Row[]) : undefined;
}

/** A few rows spread across the array, to validate key types cheaply. */
function sample(rows: Row[]): Row[] {
  return [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]];
}

function findDateKey(rows: Row[]): string | undefined {
  const probe = sample(rows);
  const keys = Object.keys(rows[0]);
  const named = keys.filter((k) => DATE_KEYS.includes(k.toLowerCase()));
  for (const k of [...named, ...keys]) {
    if (probe.every((r) => toEpoch(r[k]) !== undefined)) return k;
  }
  return undefined;
}

function numericKeys(rows: Row[], dateKey: string): string[] {
  const probe = sample(rows);
  return Object.keys(rows[0]).filter(
    (k) => k !== dateKey && probe.every((r) => typeof r[k] === 'number' && Number.isFinite(r[k])),
  );
}

const labelFor = titleCase;

function buildPoints(rows: Row[], dateKey: string, key: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const r of rows) {
    const x = toEpoch(r[dateKey]);
    const y = r[key];
    if (x !== undefined && typeof y === 'number' && Number.isFinite(y)) points.push({ x, y });
  }
  return points.sort((a, b) => a.x - b.x);
}

/**
 * Detect a chartable time series in a tool output. Accepts the raw text of
 * the result (parsed here with its own, larger cap than the JSON previews
 * use — price-history payloads easily exceed those) or an already-parsed
 * value. Returns `undefined` whenever the shape doesn't clearly match.
 */
export function parseTimeSeries(content: unknown): TimeSeries | undefined {
  let value = content;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!(t.startsWith('{') || t.startsWith('[')) || t.length > MAX_PARSE_CHARS) return undefined;
    try {
      value = JSON.parse(t);
    } catch {
      return undefined;
    }
  }

  const rows = toRows(value);
  if (!rows) return undefined;
  const dateKey = findDateKey(rows);
  if (!dateKey) return undefined;

  const numeric = numericKeys(rows, dateKey);
  const preferred = PREFERRED_KEYS.filter((k) => numeric.includes(k));
  const lineKeys = preferred.length > 0 ? [preferred[0]] : numeric.filter((k) => !BAR_KEYS.includes(k)).slice(0, MAX_LINES);
  if (lineKeys.length === 0) return undefined;

  const lines = lineKeys
    .map((k) => ({ label: labelFor(k), points: buildPoints(rows, dateKey, k) }))
    .filter((l) => l.points.length >= MIN_POINTS);
  if (lines.length === 0) return undefined;

  const barKey = BAR_KEYS.find((k) => numeric.includes(k));
  const barPoints = barKey ? buildPoints(rows, dateKey, barKey) : [];
  const bars = barKey && barPoints.length >= MIN_POINTS ? { label: labelFor(barKey), points: barPoints } : undefined;

  const xs = lines[0].points;
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { lines, bars, startLabel: fmt(xs[0].x), endLabel: fmt(xs[xs.length - 1].x) };
}
