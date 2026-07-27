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
import { useRunTreeNode } from './use-run-tree';

function toRuns(nodes: ExecNode[], threadId: string | undefined): SubagentRun[] {
  return nodes.map((node) => ({
    name: node.label,
    description: node.summary,
    status: node.status === 'error' ? 'error' : 'complete',
    // `renderDetail` runs only once the row is open, so a node's namespace read
    // and its children's rows are both deferred until someone asks for them.
    renderDetail: () => (
      <SubagentTreeNodeDetail node={node} threadId={threadId} />
    ),
  }));
}

/** One expanded row: this node's own detail, then its children as further rows.
 * Children come from the namespace read, so the recursion deepens by one level
 * per expansion rather than being materialised up front. */
function SubagentTreeNodeDetail({ node, threadId }: { node: ExecNode; threadId?: string }) {
  const { data } = useRunTreeNode(threadId, node.namespace, !!node.namespace);
  const children = data?.children.length ? data.children : node.children;
  return (
    <View className="gap-3">
      <NodeDetail threadId={threadId} namespace={node.namespace} output={node.output} />
      {children.length > 0 ? <SubagentActivity runs={toRuns(children, threadId)} /> : null}
    </View>
  );
}

/**
 * Recursive view of a run's execution forest. `nodes` is the root topology from
 * `useRunTreeRoot`; each row fetches its own namespace on expand.
 */
export function SubagentTree({ nodes, threadId }: { nodes: ExecNode[]; threadId?: string }) {
  if (nodes.length === 0) return null;
  return <SubagentActivity runs={toRuns(nodes, threadId)} />;
}
