import type { Thread } from '@langchain/langgraph-sdk';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Badge, Card, Chip, Screen, Text } from '@/components/ui';
import {
  agentTitleForThread,
  relativeTime,
  threadAgentIcon,
  threadAgentId,
  threadDescriptor,
  threadStatusTone,
} from '@/features/agent-calls/threads';
import { useCalls } from '@/features/agent-calls/use-calls';
import { AGENTS, getAgent } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

/** Status badge that gently pulses while the run is live. */
function StatusBadge({ status }: { status: Thread['status'] }) {
  const pulse = useSharedValue(1);
  const busy = status === 'busy';
  useEffect(() => {
    pulse.value = busy ? withRepeat(withTiming(0.4, { duration: 750 }), -1, true) : withTiming(1);
  }, [busy, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  if (!busy) return <Badge label={status} tone={threadStatusTone(status)} />;
  return (
    <Animated.View style={style}>
      <Badge label="running" tone="info" />
    </Animated.View>
  );
}

export default function CallsScreen() {
  const router = useRouter();
  const { data: threads, isLoading, isError, error } = useCalls();
  const [filter, setFilter] = useState<string>('all'); // 'all' | agentId | 'other'

  // Open into the agent's own screen (resumes chat / reopens the saved result).
  // Threads from an unknown/legacy agent fall back to the read-only detail page.
  const openThread = (thread: Thread) => {
    const id = threadAgentId(thread);
    if (id && getAgent(id)) {
      router.push({ pathname: '/agents/[assistantId]', params: { assistantId: id, threadId: thread.thread_id } });
    } else {
      router.push(`/calls/${thread.thread_id}`);
    }
  };

  // Which agents actually appear in the list → build the filter chips + counts.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of threads ?? []) {
      const id = threadAgentId(t);
      const key = id && getAgent(id) ? id : 'other';
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [threads]);

  const visible = (threads ?? []).filter((t) => {
    if (filter === 'all') return true;
    const id = threadAgentId(t);
    const key = id && getAgent(id) ? id : 'other';
    return key === filter;
  });

  const filterChips = [
    { key: 'all', label: 'All' },
    ...AGENTS.filter((a) => counts[a.id]).map((a) => ({ key: a.id, label: a.title })),
    ...(counts.other ? [{ key: 'other', label: 'Other' }] : []),
  ];

  return (
    <Screen plaid>
      <Text variant="title" className="pt-4">
        Calls
      </Text>
      <Text variant="muted">Past agent runs. Tap one to revisit its result.</Text>

      {threads && threads.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3 -mx-4 px-4"
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
          {filterChips.map((c) => (
            <Chip key={c.key} label={c.label} active={filter === c.key} onPress={() => setFilter(c.key)} />
          ))}
        </ScrollView>
      ) : null}

      <View className="mt-4 gap-3">
        {isLoading ? (
          <Card tone="muted">
            <Text variant="muted">Loading past calls…</Text>
          </Card>
        ) : isError ? (
          <Card tone="outline">
            <Text variant="heading">Couldn’t load calls</Text>
            <Text variant="muted">
              {error instanceof Error ? error.message : 'Check the API URL and key in Settings.'}
            </Text>
          </Card>
        ) : !threads || threads.length === 0 ? (
          <Card tone="muted">
            <Text variant="heading">No past calls yet</Text>
            <Text variant="muted">Run an agent and it’ll show up here.</Text>
          </Card>
        ) : visible.length === 0 ? (
          <Card tone="muted">
            <Text variant="muted">No calls for this filter.</Text>
          </Card>
        ) : (
          visible.map((thread) => {
            const descriptor = threadDescriptor(thread);
            return (
              <Pressable key={thread.thread_id} onPress={() => openThread(thread)} className="active:opacity-80">
                <Card tone="sticker" className="flex-row items-center gap-3">
                  <View className="h-12 w-12 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
                    <Icon name={threadAgentIcon(thread)} size={26} color={palette.frosting[600]} />
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="flex-row items-center gap-2">
                      <Text variant="heading" className="flex-shrink">{agentTitleForThread(thread)}</Text>
                      <StatusBadge status={thread.status} />
                    </View>
                    {descriptor ? (
                      <Text variant="body" className="text-sm" numberOfLines={1}>
                        {descriptor}
                      </Text>
                    ) : null}
                    <Text variant="muted" className="text-xs">{relativeTime(thread.created_at)}</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={palette.frosting[300]} weight="bold" />
                </Card>
              </Pressable>
            );
          })
        )}
      </View>
    </Screen>
  );
}
