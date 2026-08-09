/**
 * Globe/markets view preferences — which classification scheme + lens the world
 * map uses, and which timeframe performance numbers are shown over. Persisted
 * on-device (zustand `persist`, version + migrate) so the choice sticks between
 * sessions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/lib/storage/zustand';
import { DEFAULT_PERIOD, isPeriod, type Period } from './api/periods';
import type { LensId, SchemeId } from './classification';

interface MapView {
  scheme: SchemeId;
  lens: LensId;
  /** Timeframe for every performance figure (sector/country/instrument). */
  period: Period;
}

const DEFAULTS: MapView = { scheme: 'msci', lens: 'region', period: DEFAULT_PERIOD };

interface MapViewState extends MapView {
  setScheme: (scheme: SchemeId) => void;
  setLens: (lens: LensId) => void;
  setPeriod: (period: Period) => void;
}

export const useMapView = create<MapViewState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setScheme: (scheme) => set({ scheme }),
      setLens: (lens) => set({ lens }),
      setPeriod: (period) => set({ period }),
    }),
    {
      name: 'muffin.mapview.v1',
      version: 2,
      // v0 (legacy bare payload) and v1 predate `period`; both are adopted by
      // filling the default. An unknown persisted period (a value retired from
      // PERIODS) is also reset — otherwise the Segmented control restores with no
      // option selected, the same trap the agent-view store hit at v2.
      migrate: (persisted) => {
        const prev = (persisted ?? {}) as Partial<MapView>;
        return {
          ...DEFAULTS,
          ...prev,
          period: isPeriod(prev.period) ? prev.period : DEFAULT_PERIOD,
        } as MapView;
      },
      storage: persistStorage(),
      partialize: ({ scheme, lens, period }) => ({ scheme, lens, period }),
    },
  ),
);
