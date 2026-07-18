/**
 * Nameable types for the protocol-v2 stream handle.
 *
 * `@langchain/react` exposes the concrete handle as `UseStreamReturn<T>` and an
 * intentionally-erased supertype `AnyStream` for helpers/wrappers that only
 * forward the handle into selector hooks (`useMessages`, `useChannel`, …).
 * Centralising the aliases here lets every screen/component type its `stream`
 * prop instead of scattering `unknown` + `as never` casts.
 */
import type { AnyStream, UseStreamReturn } from '@langchain/react';

/**
 * Root state every muffin graph exposes. Loose by design — the authoritative
 * shapes live in the backend; the validated slices are in `schemas.ts`.
 */
export type AgentState = { messages?: unknown[] } & Record<string, unknown>;

/** A run `input` — a partial state update (what `AgentDef.buildInput` shapes). */
export type AgentInput = Partial<AgentState>;

/** The concrete stream handle `useRunStream` returns. */
export type RunStream = UseStreamReturn<AgentState>;

export type { AnyStream };
