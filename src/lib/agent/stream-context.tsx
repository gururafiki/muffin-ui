/**
 * Context for the CURRENT surface's stream handle, so detail components
 * (`SubgraphDetail`, `MemberDetail`) can reach the stream for scoped selector
 * hooks without it being prop-drilled as `unknown` through every level.
 *
 * Note this intentionally differs from `@langchain/react`'s own
 * `StreamProvider`: that provider *creates* a stream from server options,
 * while our screens already own a fully-configured handle (custom client,
 * native streaming fetch, `onThreadId` routing) via `useRunStream` — this
 * context just shares that existing handle with the subtree.
 */
import { createContext, use, type ReactNode } from 'react';

import type { AnyStream } from './stream-types';

const RunStreamContext = createContext<AnyStream | null>(null);

/** Mounted once per run surface (see `RunSurface`). */
export function RunStreamProvider({ stream, children }: { stream: AnyStream; children: ReactNode }) {
  return <RunStreamContext.Provider value={stream}>{children}</RunStreamContext.Provider>;
}

/** The surface's stream handle. Throws outside a `RunStreamProvider`. */
export function useRunStreamContext(): AnyStream {
  const stream = use(RunStreamContext);
  if (!stream) throw new Error('useRunStreamContext must be used inside a RunStreamProvider');
  return stream;
}

/**
 * The surface's stream handle, or `null` where there is none.
 *
 * The run timeline renders on the live run surfaces AND on the Calls history route,
 * which has no stream at all. Rather than fork the component tree, everything that
 * benefits from live data asks for it optionally and degrades to checkpoint history.
 */
export function useOptionalRunStream(): AnyStream | null {
  return use(RunStreamContext);
}
