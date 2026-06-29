import { Stack, useLocalSearchParams } from 'expo-router';

import { AgentRunner } from '@/components/agent-runner';
import { Card, Screen, Text } from '@/components/ui';
import { ChatScreen } from '@/features/agent-chat/chat-screen';
import { CouncilScreen } from '@/features/council/council-screen';
import { getAgent } from '@/lib/agent/registry';

const FIELD_KEYS = ['query', 'ticker', 'prompt', 'sector', 'market'];

export default function AgentRunnerRoute() {
  const params = useLocalSearchParams<Record<string, string>>();
  const assistantId = params.assistantId;
  const agent = getAgent(assistantId);
  const threadId = params.threadId || undefined;
  // A saved preset run targets its own assistant_id (the route param stays the graph id).
  const presetId = params.preset || undefined;

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
        <ChatScreen agent={agent} threadId={threadId} initialPrompt={initialPrompt} />
      </>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: agent.title }} />
      {agent.custom === 'council' ? (
        <CouncilScreen agent={agent} threadId={threadId} />
      ) : (
        <AgentRunner
          agent={agent}
          threadId={threadId}
          assistantId={presetId}
          initialValues={Object.keys(initialValues).length ? initialValues : undefined}
          autoStart={autoStart}
        />
      )}
    </Screen>
  );
}
