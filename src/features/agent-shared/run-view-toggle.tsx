/**
 * The Overview ↔ Execution-tree switch shown on every run surface. A thin
 * binding of the shared `Segmented` control to the per-agent persisted
 * `agent-view-store`, so a surface just mounts `<RunViewToggle agentId />`
 * and reads `useAgentView(agentId)` to branch its body.
 */
import { Segmented } from '@/components/ui';

import { setAgentView, useAgentView, type RunView } from './agent-view-store';

const OPTIONS: { id: RunView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tree', label: 'Execution tree' },
];

export function RunViewToggle({ agentId }: { agentId: string }) {
  const view = useAgentView(agentId);
  return <Segmented options={OPTIONS} value={view} onChange={(v) => setAgentView(agentId, v)} />;
}
