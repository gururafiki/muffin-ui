import { useRef, useState } from 'react';
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
import type { AgentDef } from '@/lib/agent/registry';
import type { Todo } from '@/lib/agent/renderers';
import { palette } from '@/theme/colors';
import { Conversation, type SubagentRuns, type ViewMode } from './conversation';
import { InterruptCard } from './interrupt';
import { useAgentStream } from './use-agent-stream';

/**
 * Multi-turn chat screen for conversational agents (`agent.chat`). Powered by
 * `useAgentStream`: passing a `threadId` resumes an existing thread (loading its
 * messages), and each message streams onto the same thread. The conversation is
 * derived from the messages, so it renders identically live and on resume.
 */
export function ChatScreen({
  agent,
  threadId: initialThreadId,
  initialPrompt,
}: {
  agent: AgentDef;
  threadId?: string;
  initialPrompt?: string;
}) {
  const { stream, submitRun, resume, actions } = useAgentStream(agent, { threadId: initialThreadId });
  // Seed the composer from a deep link only when starting a fresh conversation.
  const [draft, setDraft] = useState(initialThreadId ? '' : initialPrompt ?? '');
  const [inputH, setInputH] = useState(44);
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const messages = stream.messages;
  const busy = stream.isLoading;
  const values = stream.values as { todos?: Todo[]; subagent_runs?: SubagentRuns } | undefined;
  const todos = values?.todos;
  const subagentRuns = values?.subagent_runs;

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const human = { type: 'human', content: text };
    submitRun(
      { messages: [human] },
      { optimisticValues: (prev) => ({ ...prev, messages: [...(prev.messages ?? []), human] }) },
    );
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
            <Conversation
              messages={messages as never}
              todos={todos}
              viewMode={viewMode}
              busy={busy}
              actions={actions}
              subagentRuns={subagentRuns}
            />
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
            placeholder={busy ? 'Streaming…' : 'Message the agent…'}
            value={draft}
            onChangeText={setDraft}
            multiline
            textAlignVertical="top"
            style={{ height: inputH, maxHeight: 132 }}
            onContentSizeChange={(e) =>
              setInputH(Math.min(132, Math.max(44, e.nativeEvent.contentSize.height + 8)))
            }
            onSubmitEditing={send}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={busy ? () => stream.stop() : send}
            disabled={!busy && !draft.trim()}
            accessibilityLabel={busy ? 'Stop' : 'Send'}
            className={`h-11 w-11 items-center justify-center rounded-pill ${
              busy ? 'bg-bearish' : draft.trim() ? 'bg-frosting-500' : 'bg-frosting-200 dark:bg-night-surface-muted'
            }`}>
            <Icon name={busy ? 'close' : 'arrow-right'} size={20} color={palette.white} weight="bold" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
