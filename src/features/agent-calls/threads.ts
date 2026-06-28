/**
 * Past agent calls = LangGraph threads on the configured deployment.
 *
 * Each agent run creates a thread (`client.threads.create`) tagged with the
 * agent id in metadata (see `use-agent-run` / `use-council-run`). These helpers
 * list those threads and fetch a single one for the Calls tab + detail screen.
 */
import type { Thread } from '@langchain/langgraph-sdk';

import type { Signal } from '@/components/ui';
import { makeClient } from '@/lib/agent/client';
import { getAgent } from '@/lib/agent/registry';
import { getSettings } from '@/lib/settings/store';

/** Most recent threads first. */
export async function searchThreads(): Promise<Thread[]> {
  const client = makeClient(getSettings());
  return client.threads.search({ limit: 50, sortBy: 'created_at', sortOrder: 'desc' });
}

/** A single thread, including its final state snapshot (`values`). */
export async function getThread(threadId: string): Promise<Thread> {
  const client = makeClient(getSettings());
  return client.threads.get(threadId);
}

/** The agent id we tagged onto the thread at creation, if any. */
export function threadAgentId(thread: Thread): string | undefined {
  const id = (thread.metadata as Record<string, unknown> | undefined)?.agentId;
  return typeof id === 'string' ? id : undefined;
}

/** The raw input field values we tagged onto the thread at creation, if any. */
export function threadInputs(thread: Thread): Record<string, string> | undefined {
  const inputs = (thread.metadata as Record<string, unknown> | undefined)?.inputs;
  return inputs && typeof inputs === 'object' ? (inputs as Record<string, string>) : undefined;
}

/** Human label for a thread: the agent's title, or a generic fallback. */
export function agentTitleForThread(thread: Thread): string {
  const id = threadAgentId(thread);
  return (id && getAgent(id)?.title) || 'Agent run';
}

/** Compact relative time, e.g. "just now", "5m ago", "3d ago", or a date. */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Map an SDK thread status to a Badge tone. */
export function threadStatusTone(status: Thread['status']): Signal {
  switch (status) {
    case 'busy':
      return 'info';
    case 'error':
      return 'bearish';
    case 'interrupted':
      return 'neutral';
    case 'idle':
    default:
      return 'neutral';
  }
}
