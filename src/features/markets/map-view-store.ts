/**
 * Globe view preferences — which classification scheme + lens the world map
 * uses. Persisted on-device so the choice sticks between sessions.
 */
import { create } from 'zustand';

import { storage } from '@/lib/storage';
import type { LensId, SchemeId } from './classification';

interface MapView {
  scheme: SchemeId;
  lens: LensId;
}

const DEFAULTS: MapView = { scheme: 'msci', lens: 'region' };
const STORAGE_KEY = 'muffin.mapview.v1';

function load(): MapView {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MapView>) };
  } catch {
    return DEFAULTS;
  }
}

interface MapViewState extends MapView {
  setScheme: (scheme: SchemeId) => void;
  setLens: (lens: LensId) => void;
}

export const useMapView = create<MapViewState>((set, get) => ({
  ...load(),
  setScheme: (scheme) => {
    set({ scheme });
    persist(get);
  },
  setLens: (lens) => {
    set({ lens });
    persist(get);
  },
}));

function persist(get: () => MapViewState) {
  const { scheme, lens } = get();
  storage.set(STORAGE_KEY, JSON.stringify({ scheme, lens }));
}
