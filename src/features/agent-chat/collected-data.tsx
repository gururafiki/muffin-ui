import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Collapsible, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { makeClient } from '@/lib/agent/client';
import { relativeTime } from '@/features/agent-calls/threads';
import { JsonBlock, Markdown, parseTimeSeries, TimeSeriesChart } from '@/lib/agent/renderers';
import { getSettings } from '@/lib/settings/store';
import { palette } from '@/theme/colors';

/** One cached tool output from the store (`["cache", <tool>]` namespace). */
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

/** All cached tool outputs whose timestamp falls inside the run's window. */
async function fetchCollected(windowStart?: string, windowEnd?: string): Promise<CachedItem[]> {
  const client = makeClient(getSettings());
  const res = await client.store.searchItems(['cache'], { limit: 100 });
  const start = windowStart ? new Date(windowStart).getTime() - 60_000 : 0;
  const end = windowEnd ? new Date(windowEnd).getTime() + 60_000 : Number.POSITIVE_INFINITY;
  const items: CachedItem[] = [];
  for (const it of res.items ?? []) {
    const v = (it.value ?? {}) as {
      args?: Record<string, unknown>;
      content?: unknown;
      cached_at?: string;
      tool_name?: string;
      content_size?: number;
    };
    const at = v.cached_at ? new Date(v.cached_at).getTime() : undefined;
    if (at !== undefined && (at < start || at > end)) continue;
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
  items.sort((a, b) => (b.cachedAt ?? '').localeCompare(a.cachedAt ?? ''));
  return items;
}

function summariseArgs(args: Record<string, unknown>): string {
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

function fmtSize(bytes?: number): string | undefined {
  if (!bytes) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function DataRow({ item, last }: { item: CachedItem; last: boolean }) {
  const [open, setOpen] = useState(false);
  const body = item.text.trim();
  const json = body.startsWith('{') || body.startsWith('[') ? safeParse(body) : undefined;
  // Only parse for a chart once expanded — payloads can run to hundreds of KB.
  const chart = open ? parseTimeSeries(body) : undefined;
  return (
    <Pressable
      onPress={() => setOpen((o) => !o)}
      className={cn('py-2 active:opacity-70', !last && 'border-b border-frosting-100 dark:border-night-border')}>
      <View className="flex-row items-center gap-2.5">
        <View
          className={cn('h-2.5 w-2.5 rounded-pill', item.failed ? 'bg-bearish' : 'bg-bullish')}
        />
        <Text variant="body" className="flex-1 text-sm" numberOfLines={1}>
          {item.tool.replace(/_/g, ' ')}
        </Text>
        {item.size ? <Text variant="muted" className="text-xs">{fmtSize(item.size)}</Text> : null}
        <Text variant="muted" className="text-xs">{relativeTime(item.cachedAt)}</Text>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} color={palette.frosting[400]} weight="bold" />
      </View>
      {summariseArgs(item.args) ? (
        <Text variant="muted" className="pl-5 pt-0.5 text-xs" numberOfLines={1}>
          {summariseArgs(item.args)}
        </Text>
      ) : null}
      {item.failed && !open ? (
        <Text className="pl-5 pt-0.5 text-xs text-bearish" numberOfLines={1}>
          {body.slice(0, 120)}
        </Text>
      ) : null}
      {open ? (
        <View className="mt-2 gap-2 pl-5">
          {Object.keys(item.args).length > 0 ? <JsonBlock value={item.args} /> : null}
          {chart ? <TimeSeriesChart data={chart} /> : null}
          {json !== undefined ? (
            <JsonBlock value={json} />
          ) : (
            <Markdown value={body.length > 6000 ? body.slice(0, 6000) + '\n… (truncated)' : body} />
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

function safeParse(t: string): unknown {
  try {
    return JSON.parse(t.length > 20000 ? '' : t);
  } catch {
    return undefined;
  }
}

/**
 * "Data gathered" — every provider call the run made (via the tool-result
 * cache) plus tools that failed, each expandable to the raw payload. The cache
 * is global, so items are matched to the run by its time window.
 */
export function CollectedData({
  thread,
  values,
  busy,
  windowStart,
  windowEnd,
}: {
  thread?: string;
  values?: Record<string, unknown>;
  busy?: boolean;
  windowStart?: string;
  windowEnd?: string;
}) {
  const query = useQuery({
    queryKey: ['collected', thread ?? 'none', windowStart ?? '', windowEnd ?? ''],
    queryFn: () => fetchCollected(windowStart, windowEnd),
    enabled: !!thread,
    refetchInterval: busy ? 10_000 : false,
    staleTime: 30_000,
  });

  const items = query.data ?? [];
  const failedState = (values?.failed_tool_calls as unknown[] | undefined)?.length ?? 0;
  const failed = items.filter((i) => i.failed).length + failedState;
  if (items.length === 0 && failed === 0) return null;

  const ok = items.length - items.filter((i) => i.failed).length;
  const title = `Data gathered · ${ok} source${ok === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;

  return (
    <Collapsible title={title} icon="files">
      <View>
        {items.map((it, i) => (
          <DataRow key={it.key + i} item={it} last={i === items.length - 1} />
        ))}
        {items.length === 0 ? (
          <Text variant="muted" className="text-xs">
            No cached provider data in this run’s window.
          </Text>
        ) : null}
      </View>
    </Collapsible>
  );
}
