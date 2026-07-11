import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';

import { makeClient } from '@/lib/agent/client';
import { getSettings } from '@/lib/settings/store';

/**
 * One cached tool output from the store (`["cache", <tool>]` namespace).
 *
 * The store KEY is `get_args_hash(args)` (see the backend
 * `ToolResultCacheMiddleware`), so `key` doubles as the join key against a
 * tool-run's `args_hash` — no client-side rehashing.
 */
export interface CachedItem {
  key: string;
  tool: string;
  args: Record<string, unknown>;
  cachedAt?: string;
  size?: number;
  /** First text block of the cached content. */
  text: string;
  failed: boolean;
}

function itemText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const first = content[0] as { text?: string } | string | undefined;
    if (typeof first === 'string') return first;
    if (first && typeof first.text === 'string') return first.text;
  }
  return content == null ? '' : JSON.stringify(content);
}

/** Every cached provider call in the store (global cache; joined per-run by hash). */
async function fetchCache(): Promise<CachedItem[]> {
  const client = makeClient(getSettings());
  const res = await client.store.searchItems(['cache'], { limit: 100 });
  const items: CachedItem[] = [];
  for (const it of res.items ?? []) {
    const v = (it.value ?? {}) as {
      args?: Record<string, unknown>;
      content?: unknown;
      cached_at?: string;
      tool_name?: string;
      content_size?: number;
    };
    const text = itemText(v.content);
    items.push({
      key: it.key,
      tool: v.tool_name ?? (Array.isArray(it.namespace) ? String(it.namespace[1] ?? 'tool') : 'tool'),
      args: v.args ?? {},
      cachedAt: v.cached_at,
      size: v.content_size,
      text,
      failed: /^Error calling tool/i.test(text),
    });
  }
  return items;
}

/** Resolve a tool-run to its cached payload by exact `(tool, args_hash)`. */
export type ToolCacheLookup = (tool?: string, argsHash?: string) => CachedItem | undefined;

const ToolCacheContext = createContext<ToolCacheLookup>(() => undefined);

/** Rows outside a provider (live subgraph view) get no join → preview-only. */
export function useToolCache(): ToolCacheLookup {
  return useContext(ToolCacheContext);
}

/**
 * Fetches this run's provider-call cache once and exposes an exact
 * `(tool, args_hash) → CachedItem` lookup, so `ToolRunsSummary` rows can reveal
 * the full payload / size / timestamp on expand. Polls every 10s while the run
 * is busy (new caches land mid-run), then stops. The cache is global — the join
 * is scoped to this run by matching each row's `args_hash`, so there is no
 * cross-run bleed (unlike the old time-window heuristic).
 */
export function ToolCacheProvider({
  thread,
  busy,
  children,
}: {
  thread?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ['tool-cache', thread ?? 'none'],
    queryFn: fetchCache,
    enabled: !!thread,
    refetchInterval: busy ? 10_000 : false,
    staleTime: 30_000,
  });

  const byKey = new Map<string, CachedItem>();
  for (const it of query.data ?? []) byKey.set(`${it.tool}::${it.key}`, it);
  const lookup: ToolCacheLookup = (tool, argsHash) =>
    tool && argsHash ? byKey.get(`${tool}::${argsHash}`) : undefined;

  return <ToolCacheContext.Provider value={lookup}>{children}</ToolCacheContext.Provider>;
}

/** First recognisable identifier in a tool's args (symbol/ticker/query/…). */
export function summariseArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ['symbol', 'ticker', 'query', 'country', 'provider']) {
    const v = args[k];
    if (typeof v === 'string' && v) parts.push(v);
  }
  if (parts.length === 0) {
    const first = Object.values(args).find((v) => typeof v === 'string');
    if (typeof first === 'string') parts.push(first);
  }
  return parts.join(' · ');
}

export function fmtSize(bytes?: number): string | undefined {
  if (!bytes) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Parse a JSON payload, guarding against very large strings. */
export function safeParse(t: string): unknown {
  try {
    return JSON.parse(t.length > 20000 ? '' : t);
  } catch {
    return undefined;
  }
}
