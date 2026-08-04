import { safeParse } from '@/lib/agent/schemas';
import { TimeSeriesChart } from './chart';
import { parseTimeSeries } from './chart-data';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';

/** Tool names whose output is always a price/indicator time series. */
const CHART_TOOL_RE = /equity_price|ohlcv|_historical|get_indicators|price_performance/i;

/**
 * Per-tool-name output renderer — the pluggable seam for ONE tool call's
 * output payload (usually the joined cache text, or the capped
 * `output_preview`). Used both by `ToolRunRow` (every existing
 * `ToolRunsPanel`, app-wide) and, from Task 3, a node's tool-call facet in the
 * Timeline view.
 */
export function renderToolOutput(toolName: string | undefined, payload: unknown): React.ReactNode {
  const series = parseTimeSeries(payload);

  // Known chart tools — same series check as the default fallback below,
  // named separately so a future tool-specific override has somewhere to live.
  if (toolName && CHART_TOOL_RE.test(toolName) && series) {
    return <TimeSeriesChart data={series} />;
  }

  // Default (any tool): today's tool-runs.tsx heuristic, unchanged.
  if (series) return <TimeSeriesChart data={series} />;

  const text = typeof payload === 'string' ? payload : payload == null ? undefined : JSON.stringify(payload);
  if (text === undefined) return null;
  const body = text.trim();
  if (!body) return null;

  if (body.startsWith('{') || body.startsWith('[')) {
    const j = safeParse(body);
    return j !== undefined ? <JsonBlock value={j} /> : <Markdown value={body} />;
  }
  // No cap here any more: `Markdown` bounds what it parses and offers "Show more",
  // which beats the silent hard truncation this used to do.
  return <Markdown value={body} />;
}
