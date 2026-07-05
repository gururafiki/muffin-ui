import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AgentRunner } from '@/components/agent-runner';
import { Card, Screen, Text } from '@/components/ui';
import { ChatScreen } from '@/features/agent-chat/chat-screen';
import { useAttachStorage } from '@/features/agent-chat/use-active-run';
import { CouncilScreen } from '@/features/council/council-screen';
import { getAgent } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

const FIELD_KEYS = ['query', 'ticker', 'prompt', 'sector', 'market'];

export default function AgentRunnerRoute() {
  const params = useLocalSearchParams<Record<string, string>>();
  const assistantId = params.assistantId;
  const agent = getAgent(assistantId);
  // Pin the thread id this screen was OPENED with. When a fresh run starts,
  // useAgentStream pushes the new thread id into the URL (onThreadId →
  // router.setParams), which re-renders THIS mounted screen with params.threadId
  // set. Re-gating useAttachStorage on that live param would flip the gate to
  // `undefined` while its runs.list query loads → the streaming runner unmounts
  // mid-run ("Checking for a live run…") and the user sees nothing until refresh.
  // The mount-time value keeps the gate stable: a fresh page pins `undefined`
  // (EMPTY_STORAGE, resolves instantly), while opening WITH a threadId (Calls tab
  // / hard refresh) attaches to the live run exactly as before. Calls-tab
  // navigation pushes a NEW screen instance, so the pin is always correct there.
  const [threadId] = useState(() => params.threadId || undefined);
  // A saved preset run targets its own assistant_id (the route param stays the graph id).
  const presetId = params.preset || undefined;

  // Attach-to-running: resolve the thread's active run (if any) BEFORE mounting
  // the stream, so reopening a busy thread keeps streaming instead of showing a
  // stale snapshot. Resolves instantly when there's no threadId.
  const attachStorage = useAttachStorage(threadId);

  // Seed the runner from any field-shaped params (e.g. an "Analyse" deep link).
  const initialValues: Record<string, string> = {};
  for (const k of FIELD_KEYS) if (params[k]) initialValues[k] = params[k];
  const autoStart = params.autostart === '1';

  if (!agent) {
    return (
      <Screen>
        <Card tone="outline" className="mt-4">
          <Text variant="heading">Unknown agent</Text>
          <Text variant="muted">No agent registered for “{assistantId}”.</Text>
        </Card>
      </Screen>
    );
  }

  if (!attachStorage) {
    return (
      <Screen>
        <Stack.Screen options={{ title: agent.title }} />
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={palette.frosting[400]} />
          <Text variant="muted">Checking for a live run…</Text>
        </View>
      </Screen>
    );
  }

  // Conversational agents own their layout (chat transcript + composer).
  if (agent.chat) {
    // Pre-fill the composer when arriving from a stock/deep link.
    const initialPrompt =
      params.prompt ||
      (params.ticker
        ? `Evaluate ${params.ticker.toUpperCase()} as a long-term holding. Cover the thesis, valuation and key risks.`
        : undefined);
    return (
      <>
        <Stack.Screen options={{ title: agent.title }} />
        <ChatScreen agent={agent} threadId={threadId} initialPrompt={initialPrompt} attachStorage={attachStorage} />
      </>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: agent.title }} />
      {agent.custom === 'council' ? (
        <CouncilScreen agent={agent} threadId={threadId} attachStorage={attachStorage} />
      ) : (
        <AgentRunner
          agent={agent}
          threadId={threadId}
          assistantId={presetId}
          initialValues={Object.keys(initialValues).length ? initialValues : undefined}
          autoStart={autoStart}
          attachStorage={attachStorage}
        />
      )}
    </Screen>
  );
}
