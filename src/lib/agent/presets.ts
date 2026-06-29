/**
 * Assistant presets = named, configured LangGraph assistants saved on the
 * deployment. A preset pins a graph (`graph_id`) + a **non-secret**
 * `config.configurable` (model chains, modes, debate rounds, MCP URLs …). API
 * keys and `user_id` are never written here (see `buildPresetConfigurable`);
 * they are re-injected from on-device settings at run time, so "keys stay
 * private" holds.
 */
import type { Assistant } from '@langchain/langgraph-sdk';

import { getSettings } from '@/lib/settings/store';
import { makeClient } from './client';

/** Marks an assistant as one the app created (vs. server-seeded defaults). */
const PRESET_TAG = 'muffin_preset';

export interface Preset {
  /** assistant_id used as the run target. */
  id: string;
  /** graph_id — matches a registry `AgentDef.id`. */
  graphId: string;
  name: string;
  configurable: Record<string, unknown>;
}

function toPreset(a: Assistant): Preset {
  const configurable =
    (a.config as { configurable?: Record<string, unknown> } | undefined)?.configurable ?? {};
  return { id: a.assistant_id, graphId: a.graph_id, name: a.name || a.graph_id, configurable };
}

/** All app-created presets on the configured deployment, newest first. */
export async function listPresets(): Promise<Preset[]> {
  const client = makeClient(getSettings());
  const found = await client.assistants.search({
    metadata: { [PRESET_TAG]: true },
    limit: 100,
    sortBy: 'updated_at',
    sortOrder: 'desc',
  });
  return found.map(toPreset);
}

/** Save a named preset for a graph from a non-secret `configurable`. */
export async function createPreset(args: {
  graphId: string;
  name: string;
  configurable: Record<string, unknown>;
}): Promise<Preset> {
  const client = makeClient(getSettings());
  const a = await client.assistants.create({
    graphId: args.graphId,
    name: args.name,
    config: { configurable: args.configurable },
    metadata: { [PRESET_TAG]: true },
  });
  return toPreset(a);
}

export async function deletePreset(id: string): Promise<void> {
  const client = makeClient(getSettings());
  await client.assistants.delete(id);
}
