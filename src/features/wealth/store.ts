import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/lib/storage/zustand';
import { DEMO_ACCOUNTS, DEMO_GOALS, uid, type Account, type Goal, type Holding } from './portfolio';

interface WealthData {
  baseCurrency: string;
  accounts: Account[];
  goals: Goal[];
}

const DEFAULT: WealthData = { baseCurrency: '£', accounts: DEMO_ACCOUNTS, goals: DEMO_GOALS };

interface WealthState extends WealthData {
  addHolding: (accountId: string, holding: Omit<Holding, 'id'>) => void;
  removeHolding: (accountId: string, holdingId: string) => void;
  addGoal: (goal: Omit<Goal, 'id'>) => string;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  resetToDemo: () => void;
  /** Bulk replace (cloud-backup restore). */
  replaceAll: (data: WealthData) => void;
}

/** Snapshot of the persisted slice (cloud backup upload). */
export const getWealthData = (): WealthData => {
  const { baseCurrency, accounts, goals } = useWealth.getState();
  return { baseCurrency, accounts, goals };
};

export type { WealthData };

/**
 * Persisted via zustand `persist` — real user portfolios live here, so
 * `version` + `migrate` are the safety net for future shape changes (the
 * storage adapter wraps pre-middleware bare payloads as version 0).
 */
export const useWealth = create<WealthState>()(
  persist(
    (set) => ({
      ...DEFAULT,

      addHolding: (accountId, holding) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === accountId ? { ...a, holdings: [...a.holdings, { ...holding, id: uid() }] } : a,
          ),
        })),

      removeHolding: (accountId, holdingId) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === accountId ? { ...a, holdings: a.holdings.filter((h) => h.id !== holdingId) } : a,
          ),
        })),

      addGoal: (goal) => {
        const id = `goal-${uid()}`;
        set((s) => ({ goals: [...s.goals, { ...goal, id }] }));
        return id;
      },

      updateGoal: (id, patch) =>
        set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),

      removeGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),

      resetToDemo: () => set({ ...DEFAULT }),

      replaceAll: (data) => set({ ...data }),
    }),
    {
      name: 'muffin.wealth.v1',
      version: 1,
      // v0 (legacy bare payload) has the same shape as v1 — adopt as is.
      migrate: (persisted) => persisted as WealthData,
      storage: persistStorage(),
      partialize: ({ baseCurrency, accounts, goals }) => ({ baseCurrency, accounts, goals }),
    },
  ),
);
