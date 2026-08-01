import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Badge, Card, Collapsible, Text } from '@/components/ui';
import type { Signal } from '@/components/ui/badge';
import type { ToolRun } from '@/lib/agent/schemas';
import { palette } from '@/theme/colors';
import { JsonBlock } from './json-block';
import { renderToolOutput } from './tool-registry';

/** One tool-execution record, reconstructed from a namespace's transcript. */
export type { ToolRun } from '@/lib/agent/schemas';

const STATUS_TONE: Record<string, Signal> = {
  ok: 'bullish',
  error: 'bearish',
  duplicate_blocked: 'neutral',
  truncated: 'info',
  pending: 'info',
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
 * One expandable tool-run row: header line → input, output, error on tap.
 *
 * **Everything rendered here comes from the transcript.** `output_preview` carries the
 * FULL tool result (the name is historical — the old capture channel capped it because
 * it lived in graph state), so charts and JSON render straight from it.
 *
 * This used to additionally join the run's provider-call cache out of the LangGraph
 * Store (`store.searchItems(['cache'])`, matched on `args_hash`) to show a payload's
 * size and age. That join is gone: it was a muffin-specific side-read that a timeline
 * meant to work against any graph has no business depending on, it cost a 100-item
 * query per surface, and it added nothing the transcript did not already have.
 *
 * Known gap, unchanged: a result that exceeded the agent's size limit is replaced in the
 * transcript by a "Tool result too large…" pointer. The payload lives in that
 * namespace's `files` channel (the filesystem offload) — recoverable, but not wired up.
 */
function ToolRunRow({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const tone = statusTone(run.status);
  const parsedArgs = tryParse(run.args_preview);

  return (
    <View className="border-b border-frosting-100 py-1.5 dark:border-night-border">
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row items-center gap-2 active:opacity-70">
        <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: toneDot[tone] }} />
        <Text variant="body" className="min-w-0 flex-1 text-sm">
          {run.is_subagent_call && run.tool === 'task' ? 'delegated to subagent' : (run.tool ?? 'tool')}
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

/** A flat, tap-to-expand list of tool runs. */
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

/**
 * The tool calls one timeline node made — a `Card`+`Collapsible` envelope (the house
 * stage convention) over one row per call.
 *
 * There is deliberately **no run-wide roll-up**. A tool call belongs to the node that
 * made it, and rebuilding a flat cross-run summary would mean eagerly walking every
 * namespace (27 round trips on a criteria run) for a view the timeline already answers
 * in place. The former `mode="grouped"` variant that did this was shipped dead for two
 * milestones before being removed.
 */
export function ToolRunsPanel({
  title,
  runs,
  emptyMessage,
  icon = 'tools',
  defaultOpen = false,
}: {
  title: string;
  runs?: ToolRun[];
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

  const failed = runs.filter((r) => r.status === 'error' || r.status === 'duplicate_blocked').length;
  const meta = `${runs.length} call${runs.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;

  return (
    <Card tone="muted" className="gap-2">
      <Collapsible title={title} icon={icon} defaultOpen={defaultOpen} meta={meta}>
        <ToolRunList runs={runs} />
      </Collapsible>
    </Card>
  );
}
