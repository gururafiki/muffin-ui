import * as Clipboard from 'expo-clipboard';
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
import { Card, Chip, Screen, Skeleton, Text } from '@/components/ui';
import { SignInToRunNotice, useSignInRequiredToRun } from '@/features/account/run-gate';
import { Conversation, type MessageActions, type SubagentRuns, type ViewMode } from '@/features/agent-shared/conversation';
import { RunProgress } from '@/features/agent-shared/run-progress';
import { RunErrorCard, RunSurface } from '@/features/agent-shared/run-surface';
import { useRunStream } from '@/features/agent-shared/use-run-stream';
import type { AgentDef } from '@/lib/agent/registry';
import { collectToolRuns, ToolRunsSummary, type Todo } from '@/lib/agent/renderers';
import { palette } from '@/theme/colors';
import { InterruptCard } from './interrupt';

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
 * and the transcript takes over — the agent-chat-ui pattern. Runs on the
 * protocol-v2 `useRunStream` (the same engine as the run-view screens):
 * `stream.messages` is token-streamed and optimistically echoes the sent
 * message; reopening a running thread rejoins its event stream natively (no
 * attach gate). Message branching / edit-fork / regenerate are not offered.
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
  const { stream, submitRun, resume, threadId: liveThreadId } = useRunStream(agent, { threadId: initialThreadId });
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

  // Copy-only action bundle — the SDK echoes the sent message optimistically,
  // so no local echo is needed; edit/regenerate/branch are intentionally absent.
  const actions: MessageActions = { busy, onCopy: (t) => Clipboard.setStringAsync(t).catch(() => {}) };

  const sendText = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    submitRun({ messages: [{ type: 'human', content: text.trim() }] });
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
              {signInRequired ? (
                <SignInToRunNotice />
              ) : (
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
              )}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ── Conversation: transcript + docked composer ────────────────────────
  return (
    <RunSurface stream={stream} threadId={liveThreadId}>
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
            <RunProgress agent={agent} values={values} todos={todos} busy={busy} byNode={stream.subgraphsByNode} />
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
          {stream.isThreadLoading && messages.length === 0 ? (
            /* Reopened thread hydrating — transcript-shaped placeholders. */
            <View className="gap-3">
              <Card tone="outline" className="gap-1.5 self-end" style={{ width: '70%' }}>
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-1/2" />
              </Card>
              <Card tone="raised" className="gap-1.5">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
              </Card>
            </View>
          ) : null}
          <Conversation
            messages={messages}
            viewMode={viewMode}
            busy={busy}
            actions={actions}
            subagentRuns={subagentRuns}
          />

          {/* Tool execution — rows join the provider-call cache on expand. */}
          <ToolRunsSummary runs={collectToolRuns(values)} />

          {stream.interrupt ? <InterruptCard value={stream.interrupt.value} busy={busy} onResume={resume} /> : null}

          <RunErrorCard error={stream.error} />
        </ScrollView>

        {!atBottom ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scroll to latest message"
            onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
            className="absolute bottom-24 right-1 h-10 w-10 items-center justify-center rounded-pill border-2 border-frosting-300 bg-white active:opacity-80 dark:border-night-border dark:bg-night-surface">
            <Icon name="arrow-down" size={20} color={palette.frosting[600]} weight="bold" />
          </Pressable>
        ) : null}

        <View className="pt-2">
          {/* Signed-out users can open a shared thread (read) but can't post a
              follow-up run — show the gate instead of a composer that would 403. */}
          {signInRequired ? (
            <SignInToRunNotice />
          ) : (
            <Composer draft={draft} setDraft={setDraft} busy={busy} onSend={send} onStop={() => stream.stop()} />
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
    </RunSurface>
  );
}
