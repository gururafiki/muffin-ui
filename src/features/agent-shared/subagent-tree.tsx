/**
 * Recursive rendering of the sub-agent execution tree (backend
 * `AgentCaptureMiddleware`'s `subagent_tree` channel, reconstructed into a
 * forest by `buildForest` — see `@/lib/agent/subagent-tree`). Deliberately
 * NOT a bespoke tree widget: each `TreeRow` maps onto a `SubagentRun` so the
 * existing "Sub-agents" row look (`SubagentActivity` / `SubAgentRunRow`) —
 * avatar rail, one-line collapsed preview, tap-to-expand — is reused as-is.
 * A row's `renderDetail` renders the node's own lazy `NodeDetail` plus a
 * nested `SubagentActivity` of its children, so recursion simply falls out
 * of `SubAgentRunRow`'s existing expand/collapse; this component owns none
 * of the row rendering itself.
 */
import { View } from 'react-native';

import type { TreeRow } from '@/lib/agent/subagent-tree';
import type { SubagentRun } from './conversation-turns';
import { NodeDetail } from './node-detail';
import { SubagentActivity } from './subagent-activity';

/**
 * A short collapsed-row preview built from the node's `tool_summary` —
 * omitted (not "0 tools · 0 failed") when there's no summary or it recorded
 * zero calls, which is the common case in the current capture fixture.
 */
function previewLine(row: TreeRow): string | undefined {
  const s = row.tool_summary;
  if (!s?.count) return undefined;
  const parts = [`${s.count} tool${s.count === 1 ? '' : 's'}`];
  if (s.failed) parts.push(`${s.failed} failed`);
  return parts.join(' · ');
}

function toRuns(rows: TreeRow[], threadId: string | undefined): SubagentRun[] {
  return rows.map((row) => ({
    name: row.name,
    description: previewLine(row),
    status: row.status === 'error' ? 'error' : 'complete',
    renderDetail: () => (
      <View className="gap-3">
        <NodeDetail threadId={threadId} nodeId={row.id} hasDetail={row.has_detail} synthetic={row.synthetic} />
        {row.children.length > 0 ? <SubagentActivity runs={toRuns(row.children, threadId)} /> : null}
      </View>
    ),
  }));
}

/**
 * Recursive tree view of a run's captured sub-agent forest. `rows` comes
 * from `buildForest(collectSubagentTree(values))`; `threadId` is forwarded
 * to each node's lazy `NodeDetail` Store fetch.
 */
export function SubagentTree({ rows, threadId }: { rows: TreeRow[]; threadId?: string }) {
  if (rows.length === 0) return null;
  return <SubagentActivity runs={toRuns(rows, threadId)} />;
}
