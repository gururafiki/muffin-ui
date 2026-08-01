/**
 * Per-agent run-view preference — whether a given agent's run pages render the
 * bespoke "Overview" (default) or the generic "Timeline". Persisted on-device
 * (zustand `persist`, version + migrate) and keyed by registry agent id, so the choice
 * sticks per agent between sessions. Modeled on `features/markets/map-view-store.ts`.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/lib/storage/zustand';

export type RunView = 'overview' | 'timeline';

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
      version: 2,
      // v1 called the second view 'tree'. Retyping a persisted field REQUIRES a
      // version bump + a migration (house rule) — without it, anyone who had ever
      // opened the old Execution tree would restore a `'tree'` that no longer matches
      // any `Segmented` option, and their toggle would render with nothing selected.
      migrate: (persisted, version) => {
        const state = (persisted ?? { views: {} }) as { views: Record<string, string> };
        if (version >= 2) return state as { views: Record<string, RunView> };
        const views: Record<string, RunView> = {};
        for (const [agentId, view] of Object.entries(state.views ?? {})) {
          views[agentId] = view === 'tree' ? 'timeline' : (view as RunView);
        }
        return { views };
      },
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
