/**
 * Past agent calls = LangGraph threads on the configured deployment.
 *
 * How a thread is rendered rides entirely on data the LangGraph server sets or
 * derives — the app writes no thread metadata of its own. `metadata.graph_id`
 * (set by LangGraph on every run, 1:1 with a registry agent) drives the title /
 * icon / filter; the raw inputs behind the one-line descriptor are pulled out of
 * persisted state via the search `extract` option. These helpers list those
 * threads and fetch a single one for the Calls tab + detail screen.
 */
import type { Thread } from '@langchain/langgraph-sdk';

import type { IconName } from '@/components/icons';
import type { Signal } from '@/components/ui';
import { makeClient } from '@/lib/agent/client';
import { getAgent } from '@/lib/agent/registry';
import { getSettings } from '@/lib/settings/store';

/**
 * Most recent threads first. `select` keeps only the fields the list renders —
 * crucially NOT `values` (full thread state is tens of KB per thread; excluding
 * it shrinks the list payload ~100×). `graph_id` (in `metadata`) is all the
 * rendering needs; `extract` pulls just the descriptor inputs straight out of
 * persisted state, so no thread metadata has to be written client-side.
 */
export async function searchThreads(): Promise<Thread[]> {
  const client = makeClient(getSettings());
  return client.threads.search({
    limit: 50,
    sortBy: 'created_at',
    sortOrder: 'desc',
    select: ['thread_id', 'created_at', 'updated_at', 'status', 'metadata'],
    extract: { ticker: 'values.ticker', query: 'values.query', narrative: 'values.narrative' },
  });
}

/** A single thread, including its final state snapshot (`values`). */
export async function getThread(threadId: string): Promise<Thread> {
  const client = makeClient(getSettings());
  return client.threads.get(threadId);
}

/**
 * LangGraph's own `graph_id` for this thread — set by the server on every run
 * and identical to the registry agent id (`langgraph.json` graph name). This is
 * the reliable rendering key: unlike the app-written tag it used to replace, it
 * is present on every thread that ever ran a graph.
 */
export function threadGraphId(thread: Thread): string | undefined {
  const id = (thread.metadata as Record<string, unknown> | undefined)?.graph_id;
  return typeof id === 'string' ? id : undefined;
}

/** Human label for a thread: the agent's title, or a generic fallback. */
export function agentTitleForThread(thread: Thread): string {
  const id = threadGraphId(thread);
  return (id && getAgent(id)?.title) || 'Agent run';
}

/** The registered agent's icon for this thread (falls back to the history glyph). */
export function threadAgentIcon(thread: Thread): IconName {
  const id = threadGraphId(thread);
  return (id && getAgent(id)?.icon) || 'history';
}

/**
 * A thread-specific one-liner — e.g. "AAPL · Is the moat durable?" — so each
 * call is recognisable at a glance instead of just showing the agent's name.
 * The raw inputs come from the server's `extract` (see `searchThreads`), pulled
 * straight from persisted state. Deep-agent runs (free-text prompt, no
 * ticker/query) get no descriptor — their title already says enough.
 */
export function threadDescriptor(thread: Thread): string | undefined {
  const ex = (thread as { extracted?: Record<string, unknown> }).extracted;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const ticker = str(ex?.ticker)?.toUpperCase();
  const detail = str(ex?.query) ?? str(ex?.narrative);
  const parts = [ticker, detail].filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : undefined;
}

/** Compact relative time, e.g. "just now", "5m ago", "3d ago", or a date. */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Map an SDK thread status to a Badge tone. */
export function threadStatusTone(status: Thread['status']): Signal {
  switch (status) {
    case 'busy':
      return 'info';
    case 'error':
      return 'bearish';
    case 'interrupted':
      return 'neutral';
    case 'idle':
    default:
      return 'neutral';
  }
}
