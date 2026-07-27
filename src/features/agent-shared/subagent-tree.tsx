/**
 * Recursive rendering of a run's execution tree in the **Overview**'s row idiom.
 *
 * Deliberately NOT a bespoke tree widget: each `ExecNode` maps onto a `SubagentRun`
 * so the existing "Sub-agents" row look (`SubagentActivity` / `SubAgentRunRow`) —
 * avatar rail, one-line collapsed preview, tap-to-expand — is reused as-is. A row's
 * `renderDetail` renders that node's own lazy `NodeDetail` plus a nested
 * `SubagentActivity` of its children, so recursion falls out of the existing row
 * component rather than a new one.
 *
 * Both this and `ExecutionTree` now consume the SAME `ExecNode` model
 * (`@/lib/agent/exec-tree`) — they are two presentations of one tree, not two trees.
 */
import { View } from 'react-native';

import type { ExecNode } from '@/lib/agent/exec-tree';
import type { SubagentRun } from './conversation-turns';
import { NodeDetail } from './node-detail';
import { SubagentActivity } from './subagent-activity';

function toRuns(nodes: ExecNode[], threadId: string | undefined): SubagentRun[] {
  return nodes.map((node) => ({
    name: node.label,
    description: node.summary,
    status: node.status === 'error' ? 'error' : 'complete',
    renderDetail: () => (
      <View className="gap-3">
        <NodeDetail threadId={threadId} detailNodeId={node.detailNodeId} />
        {node.children.length > 0 ? <SubagentActivity runs={toRuns(node.children, threadId)} /> : null}
      </View>
    ),
  }));
}

/**
 * Recursive view of a run's execution forest. `nodes` comes from
 * `buildTopology(collectTopology(values))`; `threadId` is forwarded to each node's
 * lazy detail fetch.
 */
export function SubagentTree({ nodes, threadId }: { nodes: ExecNode[]; threadId?: string }) {
  if (nodes.length === 0) return null;
  return <SubagentActivity runs={toRuns(nodes, threadId)} />;
}
