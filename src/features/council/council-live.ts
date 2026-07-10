import { useChannel } from '@langchain/react';
import { useMemo } from 'react';

import { normalizeSlug } from './personas';
import type { PersonaSignal, PersonaStage } from './types';

type Dict = Record<string, unknown>;

export type PersonaLive = {
  /** The persona's freshest internal state snapshot (namespace depth 1). */
  values?: Dict;
  /** Inferred sub-stage from which channels the state has filled so far. */
  stage?: PersonaStage;
  /** The persona's verdict, live as soon as its subgraph commits it. */
  signal?: PersonaSignal;
};

/**
 * Live per-persona progress folded from the root pump's depth-1 `values`
 * events (`replay: false` taps the always-on root subscription — no extra
 * connection). Persona subgraphs are parallel nodes in ONE parent superstep,
 * so root `values.persona_signals` only appears at the barrier; each
 * persona's OWN namespaced values events are the live signal. A values event
 * fires after each inner node commits, so the filled channels tell us what
 * runs next: raw data → scoring, evidence → deciding, signal → done.
 *
 * On a mid-run refresh this restarts from the reconnect point (the root bus
 * is forward-only); personas finished earlier surface via subgraph-discovery
 * history seeding and the barrier values. Historical threads never enter
 * here — root values carry the full council.
 */
export function useCouncilLive(stream: unknown): Map<string, PersonaLive> {
  const events = useChannel(stream as never, ['values'], undefined, { replay: false });
  return useMemo(() => {
    const bySlug = new Map<string, PersonaLive>();
    for (const ev of events as { params?: { namespace?: string[]; data?: Dict } }[]) {
      const ns0 = ev?.params?.namespace?.[0];
      if (!ns0) continue; // root values — handled by stream.values
      const slug = normalizeSlug(ns0.split(':')[0] ?? '');
      if (!slug) continue;
      const values = (ev.params?.data ?? {}) as Dict;

      const ownSignals = values.persona_signals;
      const signal: PersonaSignal | undefined = Array.isArray(ownSignals)
        ? (ownSignals[ownSignals.length - 1] as PersonaSignal | undefined)
        : undefined;

      let stage: PersonaStage = 'collecting';
      if (signal) stage = 'done';
      else if (values.evidence != null) stage = 'deciding';
      else if (Object.keys(values).some((k) => !['ticker', 'query', 'as_of_date', 'messages'].includes(k))) stage = 'scoring';

      bySlug.set(slug, { values, stage, signal });
    }
    return bySlug;
  }, [events]);
}
