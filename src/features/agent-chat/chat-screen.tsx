import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Badge, Card, Chip, Screen, Text } from '@/components/ui';
import { SignInToRunNotice, useSignInRequiredToRun } from '@/features/account/run-gate';
import type { AgentDef } from '@/lib/agent/registry';
import type { Todo } from '@/lib/agent/renderers';
import { palette } from '@/theme/colors';
import { Conversation, type SubagentRuns, type ViewMode } from './conversation';
import { InterruptCard } from './interrupt';
import { RunProgress } from './run-progress';
import type { RunMetadataStorage } from './use-active-run';
import { useAgentStream } from './use-agent-stream';

const MODE_HINT: Record<ViewMode, string> = {
  summary: 'Key milestones only',
  verbose: 'Every step, with raw tool inputs & outputs',
};

/** Full-width composer card: auto-growing input with the send/stop button inside. */
function Composer({
  draft,
  setDraft,
  busy,
  onSend,
  onStop,
  autoFocus,
  placeholder,
}: {
  draft: string;
  setDraft: (t: string) => void;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [inputH, setInputH] = useState(48);
  const canSend = !busy && draft.trim().length > 0;
  return (
    <View className="w-full flex-row items-end gap-2 rounded-muffin border-2 border-frosting-200 bg-white p-2 dark:border-night-border dark:bg-night-surface">
      <TextInput
        className="flex-1 px-2 py-2 font-body text-base text-ink dark:text-night-text"
        placeholder={placeholder ?? (busy ? 'Streaming…' : 'Message the agent…')}
        placeholderTextColor={palette.frosting[300]}
        value={draft}
        onChangeText={setDraft}
        multiline
        autoFocus={autoFocus}
        textAlignVertical="top"
        style={{ height: inputH, maxHeight: 160 }}
        onContentSizeChange={(e) => setInputH(Math.min(160, Math.max(48, e.nativeEvent.contentSize.height + 12)))}
        onSubmitEditing={onSend}
        blurOnSubmit={false}
      />
      <Pressable
        onPress={busy ? onStop : onSend}
        disabled={!busy && !canSend}
        accessibilityLabel={busy ? 'Stop' : 'Send'}
        className={`h-11 w-11 items-center justify-center rounded-pill ${
          busy ? 'bg-bearish' : canSend ? 'bg-frosting-500' : 'bg-frosting-200 dark:bg-night-surface-muted'
        }`}>
        <Icon name={busy ? 'close' : 'arrow-right'} size={20} color={palette.white} weight="bold" />
      </Pressable>
    </View>
  );
}

/**
 * Multi-turn chat screen for conversational agents (`agent.chat`).
 *
 * Fresh conversation → a centred hero (agent identity, example prompts, big
 * composer). Once the first message is sent, the composer docks to the bottom
 * and the transcript takes over — the agent-chat-ui pattern. Opening a running
 * thread attaches to its live stream via `attachStorage`.
 */
export function ChatScreen({
  agent,
  threadId: initialThreadId,
  initialPrompt,
  attachStorage,
}: {
  agent: AgentDef;
  threadId?: string;
  initialPrompt?: string;
  attachStorage?: RunMetadataStorage;
}) {
  const { stream, submitRun, resume, actions, liveNode } = useAgentStream(agent, {
    threadId: initialThreadId,
    attachStorage,
  });
  // Seed the composer from a deep link only when starting a fresh conversation.
  const [draft, setDraft] = useState(initialThreadId ? '' : initialPrompt ?? '');
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const messages = stream.messages;
  const busy = stream.isLoading;
  const values = stream.values as { todos?: Todo[]; subagent_runs?: SubagentRuns } | undefined;
  const todos = values?.todos;
  const subagentRuns = values?.subagent_runs;
  const chatStarted = !!initialThreadId || messages.length > 0 || busy;
  const signInRequired = useSignInRequiredToRun();

  const sendText = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    const human = { type: 'human', content: text.trim() };
    submitRun(
      { messages: [human] },
      { optimisticValues: (prev) => ({ ...prev, messages: [...(prev.messages ?? []), human] }) },
    );
  };
  const send = () => sendText(draft);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    setAtBottom(contentSize.height - layoutMeasurement.height - contentOffset.y < 80);
  };

  // ── Hero: no conversation yet ─────────────────────────────────────────
  if (!chatStarted) {
    return (
      <Screen scroll={false}>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {/* NativeWind classes don't reach Animated.View — style inner Views. */}
            <Animated.View entering={FadeInDown.duration(350)}>
              <View className="items-center gap-2 pb-6">
                <View className="h-20 w-20 items-center justify-center rounded-bun border-2 border-frosting-200 bg-frosting-100 dark:border-night-border dark:bg-night-surface-muted">
                  <Icon name={agent.icon} size={40} color={palette.frosting[600]} />
                </View>
                <Text variant="title" className="pt-2 text-center">
                  {agent.title}
                </Text>
                <Text variant="muted" className="px-6 text-center">
                  {agent.tagline}
                </Text>
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(350).delay(80)}>
              <View className="gap-3">
                <Composer
                  draft={draft}
                  setDraft={setDraft}
                  busy={busy}
                  onSend={send}
                  onStop={() => stream.stop()}
                  placeholder="What should we dig into?"
                />
                {agent.examples?.length ? (
                  <View className="gap-2 pt-1">
                    {agent.examples.map((ex) => (
                      <Pressable
                        key={ex}
                        onPress={() => sendText(ex)}
                        className="self-center rounded-pill border border-frosting-200 bg-white/70 px-4 py-2 active:opacity-70 dark:border-night-border dark:bg-night-surface">
                        <Text variant="muted" className="text-center text-xs">
                          {ex}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ── Conversation: transcript + docked composer ────────────────────────
  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="pb-2">
          <View className="flex-row gap-2">
            <Chip label="Summary" active={viewMode === 'summary'} onPress={() => setViewMode('summary')} />
            <Chip label="Verbose" active={viewMode === 'verbose'} onPress={() => setViewMode('verbose')} />
          </View>
          <Text variant="muted" className="pt-1 text-xs">
            {MODE_HINT[viewMode]}
          </Text>
        </View>

        {busy || (todos?.length ?? 0) > 0 ? (
          <View className="pb-2">
            <RunProgress agent={agent} values={values} todos={todos} liveNode={liveNode} busy={busy} />
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => atBottom && scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled">
          <Conversation
            messages={messages as never}
            viewMode={viewMode}
            busy={busy}
            actions={actions}
            subagentRuns={subagentRuns}
          />

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
            className="absolute bottom-24 right-1 h-10 w-10 items-center justify-center rounded-pill border-2 border-frosting-300 bg-white active:opacity-80 dark:border-night-border dark:bg-night-surface">
            <Icon name="arrow-down" size={20} color={palette.frosting[600]} weight="bold" />
          </Pressable>
        ) : null}

        <View className="pt-2">
          {signInRequired && !chatStarted ? (
            <SignInToRunNotice />
          ) : (
            <Composer draft={draft} setDraft={setDraft} busy={busy} onSend={send} onStop={() => stream.stop()} />
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
