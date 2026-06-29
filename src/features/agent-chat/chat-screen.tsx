import { useStream } from '@langchain/langgraph-sdk/react';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Chip, Field, Screen, Text } from '@/components/ui';
import type { AnyMessage, Todo } from '@/lib/agent/renderers';
import { makeClient } from '@/lib/agent/client';
import type { AgentDef } from '@/lib/agent/registry';
import { queryClient } from '@/lib/query';
import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';
import { palette } from '@/theme/colors';
import { Conversation, type ViewMode } from './conversation';
import { InterruptCard } from './interrupt';

type ChatState = { messages: unknown[]; todos?: Todo[] };

/**
 * Multi-turn chat screen for conversational agents (`agent.chat`). Powered by
 * the LangGraph SDK `useStream` hook: passing a `threadId` resumes an existing
 * thread (loading its messages), and `submit` streams a follow-up onto the same
 * thread. The conversation (steps timeline + answer) is derived from the
 * messages, so it renders identically live and on resume.
 */
export function ChatScreen({ agent, threadId: initialThreadId }: { agent: AgentDef; threadId?: string }) {
  const router = useRouter();
  const client = useMemo(() => makeClient(getSettings()), []);
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);
  const [draft, setDraft] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [atBottom, setAtBottom] = useState(true);
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
      client.threads.update(id, { metadata: { agentId: agent.id } }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  const messages = stream.messages;
  const busy = stream.isLoading;
  const todos = (stream.values as ChatState | undefined)?.todos;

  const runOpts = () => ({
    config: { configurable: buildConfigurable(getSettings()) },
    streamMode: ['values'] as ('values')[],
  });

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const human = { type: 'human', content: text };
    stream.submit(
      { messages: [human] },
      { ...runOpts(), optimisticValues: (prev) => ({ ...prev, messages: [...(prev.messages ?? []), human] }) },
    );
  };

  const resume = (resumeValue: unknown) =>
    stream.submit(undefined, { ...runOpts(), command: { resume: resumeValue } });

  const editFork = (message: AnyMessage, text: string) => {
    const meta = stream.getMessagesMetadata(message as never);
    stream.submit({ messages: [{ type: 'human', content: text }] }, { ...runOpts(), checkpoint: meta?.firstSeenState?.parent_checkpoint });
  };

  const regenerate = (message: AnyMessage) => {
    const meta = stream.getMessagesMetadata(message as never);
    stream.submit(undefined, { ...runOpts(), checkpoint: meta?.firstSeenState?.parent_checkpoint });
  };

  const branchInfo = (message: AnyMessage) => {
    const meta = stream.getMessagesMetadata(message as never);
    const opts = meta?.branchOptions;
    if (!opts || opts.length <= 1 || !meta?.branch) return undefined;
    const index = opts.indexOf(meta.branch);
    return { index, total: opts.length, prev: opts[index - 1], next: opts[index + 1] };
  };

  const actions = {
    busy,
    onCopy: (text: string) => Clipboard.setStringAsync(text).catch(() => {}),
    onEdit: editFork,
    onRegenerate: regenerate,
    branchInfo,
    onSetBranch: stream.setBranch,
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    setAtBottom(contentSize.height - layoutMeasurement.height - contentOffset.y < 80);
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row gap-2 pb-2">
          <Chip label="Summary" active={viewMode === 'summary'} onPress={() => setViewMode('summary')} />
          <Chip label="Verbose" active={viewMode === 'verbose'} onPress={() => setViewMode('verbose')} />
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => atBottom && scrollRef.current?.scrollToEnd({ animated: true })}
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
            <Conversation messages={messages as never} todos={todos} viewMode={viewMode} busy={busy} actions={actions} />
          )}

          {stream.interrupt ? <InterruptCard value={stream.interrupt.value} busy={busy} onResume={resume} /> : null}

          {stream.error ? (
            <Card tone="outline" className="gap-1">
              <Badge label="error" tone="bearish" />
              <Text variant="muted">{stream.error instanceof Error ? stream.error.message : String(stream.error)}</Text>
            </Card>
          ) : null}
        </ScrollView>

        {!atBottom ? (
          <Pressable
            onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
            className="absolute bottom-20 right-1 h-10 w-10 items-center justify-center rounded-pill border-2 border-frosting-300 bg-white active:opacity-80 dark:border-night-border dark:bg-night-surface">
            <Icon name="arrow-down" size={20} color={palette.frosting[600]} weight="bold" />
          </Pressable>
        ) : null}

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
