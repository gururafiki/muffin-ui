/**
 * Per-agent run-view preference — whether a given agent's run pages render the
 * bespoke "Overview" (default) or the generic "Execution tree". Persisted
 * on-device (zustand `persist`, version + migrate) and keyed by registry agent
 * id, so the choice sticks per agent between sessions. Modeled on
 * `features/markets/map-view-store.ts`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/lib/storage/zustand';

export type RunView = 'overview' | 'tree';

interface AgentViewState {
  /** agentId → chosen view; absent = the default ('overview'). */
  views: Record<string, RunView>;
  setView: (agentId: string, view: RunView) => void;
}

const useAgentViewStore = create<AgentViewState>()(
  persist(
    (set) => ({
      views: {},
      setView: (agentId, view) =>
        set((s) => ({ views: { ...s.views, [agentId]: view } })),
    }),
    {
      name: 'muffin.agentview.v1',
      version: 1,
      // v0 (never shipped) → adopt as is.
      migrate: (persisted) => persisted as { views: Record<string, RunView> },
      storage: persistStorage(),
      partialize: ({ views }) => ({ views }),
    },
  ),
);

/** Reactive selector: the chosen view for one agent (default 'overview'). */
export function useAgentView(agentId: string): RunView {
  return useAgentViewStore((s) => s.views[agentId] ?? 'overview');
}

/** Set the view for one agent. */
export function setAgentView(agentId: string, view: RunView): void {
  useAgentViewStore.getState().setView(agentId, view);
}
