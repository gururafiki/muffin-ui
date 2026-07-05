import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Collapsible, Text } from '@/components/ui';
import type { Signal } from '@/components/ui/badge';
import { palette } from '@/theme/colors';
import { TimeSeriesChart } from './chart';
import { parseTimeSeries } from './chart-data';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';

/**
 * One tool-execution record, mirroring the backend
 * `ToolTelemetryMiddleware` record (all fields optional for forward-compat).
 */
export type ToolRun = {
  tool?: string;
  agent?: string;
  is_subagent_call?: boolean;
  status?: 'ok' | 'error' | 'duplicate_blocked' | 'truncated' | string;
  cache_hit?: boolean;
  args_preview?: string;
  output_preview?: string;
  error?: string | null;
};

type Dict = Record<string, unknown>;

/**
 * Gather every tool run in a criteria-analysis run: the stage-level records at
 * the top level plus each criterion's own `tool_runs` (attached by the backend
 * worker's `package` node). Reads streamed `values` — identical live and
 * post-refresh.
 */
export function collectToolRuns(values: unknown): ToolRun[] {
  if (!values || typeof values !== 'object') return [];
  const v = values as Dict;
  const top = Array.isArray(v.tool_runs) ? (v.tool_runs as ToolRun[]) : [];
  const evals = Array.isArray(v.criterion_evaluations) ? (v.criterion_evaluations as Dict[]) : [];
  const perCriterion = evals.flatMap((e) => (Array.isArray(e?.tool_runs) ? (e.tool_runs as ToolRun[]) : []));
  return [...top, ...perCriterion];
}

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

/** One expandable tool-run row: header line → args, output, error on tap. */
function ToolRunRow({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const tone = statusTone(run.status);
  const parsedArgs = tryParse(run.args_preview);
  const series = run.status === 'ok' ? parseTimeSeries(run.output_preview) : undefined;

  return (
    <View className="border-b border-frosting-100 py-1.5 dark:border-night-border">
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row items-center gap-2 active:opacity-70">
        <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: toneDot[tone] }} />
        <Text variant="body" className="flex-1 text-sm">
          {run.is_subagent_call && run.tool === 'task' ? 'delegated to subagent' : run.tool ?? 'tool'}
        </Text>
        {run.cache_hit ? <Badge label="cached" tone="info" /> : null}
        {run.status && run.status !== 'ok' ? <Badge label={run.status.replace(/_/g, ' ')} tone={tone} /> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} color={palette.frosting[400]} weight="bold" />
      </Pressable>

      {open ? (
        <View className="gap-2 pl-4 pt-2">
          {run.args_preview ? (
            <View className="gap-1">
              <Text variant="label">Input</Text>
              {parsedArgs !== undefined ? (
                <JsonBlock value={parsedArgs} />
              ) : (
                <Text variant="muted" className="text-xs">{run.args_preview}</Text>
              )}
            </View>
          ) : null}

          {run.output_preview ? (
            <View className="gap-1">
              <Text variant="label">Output</Text>
              {series ? <TimeSeriesChart data={series} /> : <Markdown value={run.output_preview} />}
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
 * Run-level tool-execution summary: total success/fail per tool (tap a tool to
 * see its individual runs with inputs/outputs/errors) plus a failures roll-up.
 * Collapsed by default; renders nothing when telemetry produced no records.
 */
export function ToolRunsSummary({ runs }: { runs?: ToolRun[] }) {
  if (!runs?.length) return null;
  const { stats, failures } = summarise(runs);
  const total = runs.length;
  const failed = failures.length;

  return (
    <Card tone="muted" className="gap-2">
      <Collapsible
        title="Tool execution"
        icon="tools"
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
