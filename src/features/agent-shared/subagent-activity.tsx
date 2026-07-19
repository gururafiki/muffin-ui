/**
 * The "Sub-agents" panel and the per-member state digest — shared by the
 * generic runner, the council screen, and the Calls history detail.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Avatar, Badge, Card, Text } from '@/components/ui';
import { StructuredOutput } from '@/lib/agent/renderers';
import { titleCase } from '@/lib/format';
import { palette } from '@/theme/colors';
import { runPreview, type SubagentRun } from './conversation-turns';
import { Conversation } from './conversation';

/**
 * "Sub-agents" — a soft, progressive panel of the specialists a run delegated to
 * (native sub-agents: trading analysts, council personas; or captured deep-agent
 * sub-agents). Each is an avatar row with a one-line preview; tapping reveals its
 * own nested timeline. Nothing is expanded until you ask for it.
 */
export function SubagentActivity({ runs }: { runs?: SubagentRun[] }) {
  const list = (runs ?? []).filter(
    (r) =>
      (r.messages?.length ?? 0) > 0 ||
      Object.keys(r.stateValues ?? {}).length > 0 ||
      r.renderDetail != null ||
      r.status != null,
  );
  if (list.length === 0) return null;

  return (
    <Card tone="sticker" className="gap-1">
      <View className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
          <Icon name="agents" size={16} color={palette.frosting[600]} />
        </View>
        <View className="flex-1">
          <Text variant="heading" className="text-base">Sub-agents</Text>
          <Text variant="muted" className="text-xs">
            {list.length} specialist{list.length > 1 ? 's' : ''} · tap to see how each one worked
          </Text>
        </View>
      </View>
      <View className="mt-1">
        {list.map((r, i) => (
          <SubAgentRunRow key={(r.name ?? '') + i} run={r} last={i === list.length - 1} />
        ))}
      </View>
    </Card>
  );
}

const DATA_KEY_RE = /(_series|_history|_latest|_1y)$|^(market_cap|insider_trades|company_news|metrics_history|prices_1y)$/;

/**
 * Stage-oriented digest of a native sub-agent's state: which data it collected
 * (chips with point counts) and the evidence it computed. Gives persona /
 * specialist detail real depth even when only the final message survived.
 */
export function SubagentStateDigest({ values }: { values?: Record<string, unknown> }) {
  if (!values) return null;
  const dataKeys = Object.entries(values).filter(([k, v]) => DATA_KEY_RE.test(k) && v != null);
  const evidence = values.evidence;
  const hasEvidence = evidence != null && (!Array.isArray(evidence) || evidence.length > 0);
  if (dataKeys.length === 0 && !hasEvidence) return null;

  return (
    <View className="gap-2">
      {dataKeys.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Data collected</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {dataKeys.map(([k, v]) => {
              const label = titleCase(k.replace(DATA_KEY_RE, '').replace(/_/g, ' ').trim() || k);
              const count = Array.isArray(v) ? ` · ${v.length}` : '';
              return <Badge key={k} label={`${label}${count}`} tone="info" />;
            })}
          </View>
        </View>
      ) : null}
      {hasEvidence ? (
        <View className="gap-1">
          <Text variant="label">Evidence</Text>
          <StructuredOutput value={evidence} />
        </View>
      ) : null}
    </View>
  );
}

const RAIL = { position: 'absolute' as const, top: 18, bottom: -10, width: 2 };

function SubAgentRunRow({ run, last }: { run: SubagentRun; last: boolean }) {
  const [open, setOpen] = useState(false);
  const label = titleCase(run.name || 'sub-agent');
  const preview = runPreview(run);
  const steps = run.messages?.length ?? 0;
  // Never open into an empty container: without detail the row is inert.
  const expandable =
    run.renderDetail != null || (run.messages?.length ?? 0) > 0 || Object.keys(run.stateValues ?? {}).length > 0 || !!run.description;

  return (
    <View className="flex-row gap-3">
      <View className="w-8 items-center">
        {!last ? <View style={RAIL} className="bg-frosting-100 dark:bg-night-border" /> : null}
        <View className="z-10 rounded-pill">
          <Avatar name={label} size={32} />
        </View>
      </View>
      <Pressable
        onPress={expandable ? () => setOpen((o) => !o) : undefined}
        className="flex-1 border-b border-frosting-100 py-2 active:opacity-70 dark:border-night-border">
        <View className="flex-row items-center gap-2">
          <Text variant="body" className="flex-1 text-sm font-heading">{label}</Text>
          {run.status === 'running' ? <ActivityIndicator size="small" color={palette.butter[500]} /> : null}
          {run.status === 'error' ? <Badge label="error" tone="bearish" /> : null}
          {steps > 1 ? <Text variant="muted" className="text-xs">{steps} steps</Text> : null}
          {expandable ? (
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
          ) : null}
        </View>
        {!open && preview ? (
          <Text variant="muted" className="mt-0.5 text-xs" numberOfLines={2}>{preview}</Text>
        ) : null}
        {open ? (
          <View className="mt-2 gap-3 rounded-crumb bg-white/50 p-2 dark:bg-night-bg/40">
            {run.description ? (
              <View className="gap-1">
                <Text variant="label">Brief</Text>
                <Text variant="muted" className="text-xs">{run.description}</Text>
              </View>
            ) : null}
            {run.renderDetail?.()}
            <SubagentStateDigest values={run.stateValues} />
            {run.messages?.length ? <Conversation messages={run.messages} viewMode="verbose" /> : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
