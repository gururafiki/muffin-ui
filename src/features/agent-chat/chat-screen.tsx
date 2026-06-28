import { useStream } from '@langchain/langgraph-sdk/react';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Field, Screen, Text } from '@/components/ui';
import { makeClient } from '@/lib/agent/client';
import type { AgentDef } from '@/lib/agent/registry';
import { MessageList } from '@/lib/agent/renderers';
import { queryClient } from '@/lib/query';
import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';
import { palette } from '@/theme/colors';

type ChatState = { messages: unknown[] };

/**
 * Multi-turn chat screen for conversational agents (`agent.chat`). Powered by
 * the LangGraph SDK `useStream` hook: passing a `threadId` resumes an existing
 * thread (loading its messages), and `submit` streams a follow-up onto the same
 * thread. New threads are tagged with the agent id so they appear, labelled, in
 * the Calls list.
 */
export function ChatScreen({ agent, threadId: initialThreadId }: { agent: AgentDef; threadId?: string }) {
  const router = useRouter();
  const client = useMemo(() => makeClient(getSettings()), []);
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const stream = useStream<ChatState>({
    client,
    assistantId: agent.id,
    threadId: threadId ?? null,
    messagesKey: 'messages',
    reconnectOnMount: true,
    fetchStateHistory: true,
    onThreadId: (id) => {
      setThreadId(id);
      router.setParams({ threadId: id });
      // Tag the freshly-created thread so the Calls list can label it, then
      // refresh that list. `useStream` creates the thread without metadata.
      client.threads.update(id, { metadata: { agentId: agent.id } }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  const messages = stream.messages;
  const busy = stream.isLoading;

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const human = { type: 'human', content: text };
    const settings = getSettings();
    stream.submit(
      { messages: [human] },
      {
        config: { configurable: buildConfigurable(settings) },
        streamMode: ['values'],
        optimisticValues: (prev) => ({ ...prev, messages: [...(prev.messages ?? []), human] }),
      },
    );
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled">
          {messages.length === 0 ? (
            <Card tone="sticker" className="mt-2 gap-2">
              <View className="flex-row items-center gap-3">
                <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
                  <Icon name={agent.icon} size={26} color={palette.frosting[600]} />
                </View>
                <View className="flex-1">
                  <Text variant="heading">{agent.title}</Text>
                  <Text variant="muted">{agent.tagline}</Text>
                </View>
              </View>
              <Text variant="muted">Send a message to start the conversation.</Text>
            </Card>
          ) : (
            <MessageList messages={messages as never} />
          )}

          {stream.interrupts && stream.interrupts.length > 0 ? (
            <Card tone="outline" className="gap-1">
              <Badge label="waiting for input" tone="info" />
              <Text variant="muted">The agent paused for input. Reply below to continue.</Text>
            </Card>
          ) : null}

          {stream.error ? (
            <Card tone="outline" className="gap-1">
              <Badge label="error" tone="bearish" />
              <Text variant="muted">
                {stream.error instanceof Error ? stream.error.message : String(stream.error)}
              </Text>
            </Card>
          ) : null}
        </ScrollView>

        <View className="flex-row items-end gap-2 border-t border-frosting-100 pt-2 dark:border-night-border">
          <Field
            className="flex-1"
            placeholder="Message…"
            value={draft}
            onChangeText={setDraft}
            multiline
            onSubmitEditing={send}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={busy ? () => stream.stop() : send}
            disabled={!busy && !draft.trim()}
            className={`h-12 w-12 items-center justify-center rounded-pill ${
              busy ? 'bg-bearish' : draft.trim() ? 'bg-frosting-500' : 'bg-frosting-200 dark:bg-night-surface-muted'
            }`}>
            <Icon name={busy ? 'close' : 'arrow-right'} size={22} color={palette.white} weight="bold" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
