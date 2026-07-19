/**
 * Globe view preferences — which classification scheme + lens the world map
 * uses. Persisted on-device (zustand `persist`, version + migrate) so the
 * choice sticks between sessions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/lib/storage/zustand';
import type { LensId, SchemeId } from './classification';

interface MapView {
  scheme: SchemeId;
  lens: LensId;
}

const DEFAULTS: MapView = { scheme: 'msci', lens: 'region' };

interface MapViewState extends MapView {
  setScheme: (scheme: SchemeId) => void;
  setLens: (lens: LensId) => void;
}

export const useMapView = create<MapViewState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setScheme: (scheme) => set({ scheme }),
      setLens: (lens) => set({ lens }),
    }),
    {
      name: 'muffin.mapview.v1',
      version: 1,
      // v0 (legacy bare payload) has the same shape as v1 — adopt as is.
      migrate: (persisted) => persisted as MapView,
      storage: persistStorage(),
      partialize: ({ scheme, lens }) => ({ scheme, lens }),
    },
  ),
);
