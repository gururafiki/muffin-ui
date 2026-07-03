import { useStream } from '@langchain/langgraph-sdk/react';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';

import { makeClient } from '@/lib/agent/client';
import type { AgentDef } from '@/lib/agent/registry';
import type { AnyMessage } from '@/lib/agent/renderers';
import { queryClient } from '@/lib/query';
import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';
import type { RunMetadataStorage } from './use-active-run';

export type AgentState = { messages?: unknown[] } & Record<string, unknown>;

/** The graph node currently executing (from streamed `updates`). */
export type LiveNode = { node: string; namespace: string[]; ts: number };

/**
 * Shared engine for every agent run — chat and single-shot alike. Wraps the
 * LangGraph SDK `useStream` hook so a run is always thread-scoped:
 *
 * - starting a run creates a thread and pushes its id into the URL (`onThreadId`
 *   → `router.setParams`), so a refresh keeps streaming instead of showing a
 *   fresh form, and reopening from the Calls tab reuses the exact same screen;
 * - `reconnectOnMount` + `fetchStateHistory` resume an in-flight run and hydrate
 *   `values`/`messages`, so the live view and the from-history view are rendered
 *   from the same source (natural streaming continuation).
 *
 * New threads are tagged with `{ agentId, inputs }` metadata so the Calls list
 * can label + describe them.
 */
export function useAgentStream(
  agent: AgentDef,
  opts: {
    assistantId?: string;
    threadId?: string;
    /** Pre-seeded storage from `useAttachStorage` — attaches to a live run. */
    attachStorage?: RunMetadataStorage;
  },
) {
  const router = useRouter();
  const client = useMemo(() => makeClient(getSettings()), []);
  const [threadId, setThreadId] = useState<string | undefined>(opts.threadId);
  const inputsRef = useRef<Record<string, string> | undefined>(undefined);
  const [liveNode, setLiveNode] = useState<LiveNode | undefined>(undefined);
  const attachStorage = opts.attachStorage;

  const stream = useStream<AgentState>({
    client,
    assistantId: opts.assistantId || agent.id,
    threadId: threadId ?? null,
    messagesKey: 'messages',
    reconnectOnMount: attachStorage ? () => attachStorage : true,
    fetchStateHistory: true,
    onThreadId: (id) => {
      setThreadId(id);
      router.setParams({ threadId: id });
      client.threads
        .update(id, { metadata: { agentId: agent.id, ...(inputsRef.current ? { inputs: inputsRef.current } : {}) } })
        .catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
    onUpdateEvent: (data, options) => {
      const nodes = Object.keys((data ?? {}) as Record<string, unknown>);
      if (nodes.length === 0) return;
      setLiveNode({ node: nodes[nodes.length - 1], namespace: options?.namespace ?? [], ts: Date.now() });
    },
  });

  const runOpts = (overrides?: Record<string, unknown>) => ({
    config: { configurable: { ...buildConfigurable(getSettings()), ...(overrides ?? {}) } },
    // `messages-tuple` streams LLM token chunks; `useStream` accumulates them
    // into partial messages so the answer renders token-by-token. Named
    // explicitly rather than relying on the mode the `stream.messages` getter
    // auto-registers, so streaming survives a consumer refactor. Sub-agent
    // (namespaced) chunks are routed to the SDK's subagent manager, not the
    // top-level conversation.
    streamMode: ['values', 'updates', 'messages-tuple'] as ('values' | 'updates' | 'messages-tuple')[],
    streamSubgraphs: true as const,
  });

  /** Start (or continue) a run with a shaped graph `input`. */
  const submitRun = (
    input: Record<string, unknown>,
    o?: {
      overrides?: Record<string, unknown>;
      /** Raw field values to tag onto the thread for the Calls descriptor. */
      inputs?: Record<string, string>;
      optimisticValues?: (prev: AgentState) => Partial<AgentState>;
    },
  ) => {
    if (o?.inputs) inputsRef.current = o.inputs;
    stream.submit(input as never, {
      ...runOpts(o?.overrides),
      ...(o?.optimisticValues ? { optimisticValues: o.optimisticValues as never } : {}),
    });
  };

  /** Resume a human-in-the-loop interrupt. */
  const resume = (resumeValue: unknown, overrides?: Record<string, unknown>) =>
    stream.submit(undefined, { ...runOpts(overrides), command: { resume: resumeValue } });

  const editFork = (message: AnyMessage, text: string) => {
    const meta = stream.getMessagesMetadata(message as never);
    stream.submit({ messages: [{ type: 'human', content: text }] } as never, {
      ...runOpts(),
      checkpoint: meta?.firstSeenState?.parent_checkpoint,
    });
  };

  const regenerate = (message: AnyMessage) => {
    const meta = stream.getMessagesMetadata(message as never);
    stream.submit(undefined, { ...runOpts(), checkpoint: meta?.firstSeenState?.parent_checkpoint });
  };

  const branchInfo = (message: AnyMessage) => {
    const meta = stream.getMessagesMetadata(message as never);
    const b = meta?.branchOptions;
    if (!b || b.length <= 1 || !meta?.branch) return undefined;
    const index = b.indexOf(meta.branch);
    return { index, total: b.length, prev: b[index - 1], next: b[index + 1] };
  };

  /** Message action bundle for the Conversation renderer. */
  const actions = {
    busy: stream.isLoading,
    onCopy: (t: string) => Clipboard.setStringAsync(t).catch(() => {}),
    onEdit: editFork,
    onRegenerate: regenerate,
    branchInfo,
    onSetBranch: stream.setBranch,
  };

  return { stream, threadId, submitRun, resume, actions, liveNode: stream.isLoading ? liveNode : undefined };
}
