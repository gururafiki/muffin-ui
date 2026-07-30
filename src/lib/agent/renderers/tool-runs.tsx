import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Badge, Card, Collapsible, Text } from '@/components/ui';
import type { Signal } from '@/components/ui/badge';
import { relativeTime } from '@/features/agent-calls/threads';
import type { ToolRun } from '@/lib/agent/schemas';
import { fmtSize, summariseArgs, useToolCache } from '@/lib/agent/tool-cache';
import { palette } from '@/theme/colors';
import { JsonBlock } from './json-block';
import { renderToolOutput } from './tool-registry';

/** One tool-execution record — the schema mirrors `ToolTelemetryMiddleware`. */
export type { ToolRun } from '@/lib/agent/schemas';

const STATUS_TONE: Record<string, Signal> = {
  ok: 'bullish',
  error: 'bearish',
  duplicate_blocked: 'neutral',
  truncated: 'info',
};

const statusTone = (s?: string): Signal => STATUS_TONE[s ?? ''] ?? 'info';

function tryParse(text?: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One expandable tool-run row: header line → args, output, error on tap.
 *
 * `output_preview` now carries the FULL content, read from the transcript rather
 * than a capped copy in graph state, so charts and JSON render from it directly.
 * The cache join (`useToolCache` by `args_hash`) is therefore no longer needed to
 * see the output — it only adds the payload's size and age to the header. Rows
 * with no cache entry (errors, non-cacheable tools, `task` delegations) simply
 * omit those. This folds the former "Data gathered" panel into "Tool execution".
 *
 * Known gap: a result that exceeded the agent's size limit is replaced in the
 * transcript by a "Tool result too large…" pointer and carries no `args_hash`,
 * so neither path shows the payload. It lives in that namespace's `files`
 * channel (the filesystem offload) — recoverable, but not wired up.
 */
function ToolRunRow({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const hit = useToolCache()(run.tool ?? undefined, run.args_hash ?? undefined);
  const tone = statusTone(run.status);

  // Prefer the full cached args/payload; fall back to the capped previews.
  const parsedArgs = hit ? hit.args : tryParse(run.args_preview);
  const body = (hit?.text ?? '').trim();
  const argsLine = hit ? summariseArgs(hit.args) : '';

  return (
    <View className="border-b border-frosting-100 py-1.5 dark:border-night-border">
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row items-center gap-2 active:opacity-70">
        <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: toneDot[tone] }} />
        <Text variant="body" className="flex-1 text-sm">
          {run.is_subagent_call && run.tool === 'task' ? 'delegated to subagent' : run.tool ?? 'tool'}
        </Text>
        {hit?.size ? <Text variant="muted" className="text-xs">{fmtSize(hit.size)}</Text> : null}
        {hit?.cachedAt ? <Text variant="muted" className="text-xs">{relativeTime(hit.cachedAt)}</Text> : null}
        {run.cache_hit ? <Badge label="cached" tone="info" /> : null}
        {run.status && run.status !== 'ok' ? <Badge label={run.status.replace(/_/g, ' ')} tone={tone} /> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} color={palette.frosting[400]} weight="bold" />
      </Pressable>

      {argsLine ? (
        <Text variant="muted" className="pl-4 pt-0.5 text-xs" numberOfLines={1}>
          {argsLine}
        </Text>
      ) : null}

      {open ? (
        <View className="gap-2 pl-4 pt-2">
          {(hit && Object.keys(hit.args).length > 0) || run.args_preview ? (
            <View className="gap-1">
              <Text variant="label">Input</Text>
              {parsedArgs !== undefined ? (
                <JsonBlock value={parsedArgs} />
              ) : (
                <Text variant="muted" className="text-xs">{run.args_preview}</Text>
              )}
            </View>
          ) : null}

          {hit && body ? (
            <View className="gap-1">
              <Text variant="label">Output</Text>
              {renderToolOutput(run.tool ?? undefined, body)}
            </View>
          ) : !hit && run.output_preview ? (
            <View className="gap-1">
              <Text variant="label">Output</Text>
              {renderToolOutput(run.tool ?? undefined, run.output_preview)}
            </View>
          ) : null}

          {run.error ? (
            <View className="gap-1">
              <Text variant="label">Error</Text>
              <Text variant="body" className="text-sm" style={{ color: palette.bearish }}>{run.error}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const toneDot: Record<Signal, string> = {
  bullish: palette.leaf[500],
  bearish: palette.bearish,
  neutral: palette.butter[500],
  info: palette.frosting[400],
};

/** A flat, tap-to-expand list of tool runs (used per criterion + per tool). */
export function ToolRunList({ runs }: { runs?: ToolRun[] }) {
  if (!runs?.length) return null;
  return (
    <View>
      {runs.map((r, i) => (
        <ToolRunRow key={i} run={r} />
      ))}
    </View>
  );
}

type ToolStat = { tool: string; ok: number; failed: number; cached: number; runs: ToolRun[] };

function summarise(runs: ToolRun[]): { stats: ToolStat[]; failures: ToolRun[] } {
  const byTool = new Map<string, ToolStat>();
  const failures: ToolRun[] = [];
  for (const r of runs) {
    const tool = r.tool ?? 'tool';
    const stat = byTool.get(tool) ?? { tool, ok: 0, failed: 0, cached: 0, runs: [] };
    stat.runs.push(r);
    if (r.cache_hit) stat.cached += 1;
    if (r.status === 'error' || r.status === 'duplicate_blocked') {
      stat.failed += 1;
      failures.push(r);
    } else {
      stat.ok += 1;
    }
    byTool.set(tool, stat);
  }
  const stats = [...byTool.values()].sort((a, b) => b.runs.length - a.runs.length);
  return { stats, failures };
}

/** Per-tool row of the summary: counts + expandable run list. */
function ToolStatRow({ stat }: { stat: ToolStat }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="border-b border-frosting-100 py-1.5 dark:border-night-border">
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row items-center gap-2 active:opacity-70">
        <Text variant="body" className="flex-1 text-sm">{stat.tool}</Text>
        {stat.ok > 0 ? <Badge label={`${stat.ok} ok`} tone="bullish" /> : null}
        {stat.failed > 0 ? <Badge label={`${stat.failed} failed`} tone="bearish" /> : null}
        {stat.cached > 0 ? <Badge label={`${stat.cached} cached`} tone="info" /> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} color={palette.frosting[400]} weight="bold" />
      </Pressable>
      {open ? (
        <View className="pl-2 pt-1">
          <ToolRunList runs={stat.runs} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Shared tool-activity panel — a single `Card`+`Collapsible` envelope around
 * either a flat run list (`mode="flat"` — one row per call, used per-subagent
 * or per-criterion) or a per-tool grouped summary with ok/failed/cached
 * stats (`mode="grouped"` — used for the whole-run "Tool execution" view).
 * Both modes bottom out in the same `ToolRunRow`; only the container and
 * grouping differ, which is what previously diverged by accident across 4
 * near-identical call sites ("Tool calls" / "Tool execution" / "Data
 * collection" / "Data collected"). Collapsed by default; with no records it
 * renders nothing — unless the caller passes `emptyMessage` (a hint for
 * finished runs that predate capture).
 */
export function ToolRunsPanel({
  title,
  runs,
  mode = 'flat',
  emptyMessage,
  icon = 'tools',
  defaultOpen = false,
}: {
  title: string;
  runs?: ToolRun[];
  mode?: 'flat' | 'grouped';
  emptyMessage?: string;
  icon?: IconName;
  defaultOpen?: boolean;
}) {
  if (!runs?.length) {
    if (!emptyMessage) return null;
    return (
      <Card tone="muted">
        <View className="flex-row items-center gap-2">
          <Icon name={icon} size={16} color={palette.frosting[400]} />
          <Text variant="muted" className="flex-1 text-xs">{emptyMessage}</Text>
        </View>
      </Card>
    );
  }

  const total = runs.length;

  if (mode === 'grouped') {
    const { stats, failures } = summarise(runs);
    const failed = failures.length;
    return (
      <Card tone="muted" className="gap-2">
        <Collapsible
          title={title}
          icon={icon}
          defaultOpen={defaultOpen}
          meta={`${total} call${total === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`}
        >
          <View className="gap-1 pt-1">
            {stats.map((s) => (
              <ToolStatRow key={s.tool} stat={s} />
            ))}

            {failures.length > 0 ? (
              <View className="gap-1 pt-2">
                <Text variant="label">Failures</Text>
                {failures.map((f, i) => (
                  <Text key={i} variant="muted" className="text-xs">
                    • {f.tool}: {f.error ?? f.status}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </Collapsible>
      </Card>
    );
  }

  return (
    <Card tone="muted" className="gap-2">
      <Collapsible title={title} icon={icon} defaultOpen={defaultOpen} meta={`${total} call${total === 1 ? '' : 's'}`}>
        <ToolRunList runs={runs} />
      </Collapsible>
    </Card>
  );
}
