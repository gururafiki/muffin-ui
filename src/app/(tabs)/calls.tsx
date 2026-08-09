import type { Thread } from '@langchain/langgraph-sdk';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Card, Chip, Screen, Skeleton, Text } from '@/components/ui';
import { CallCard, openThreadRoute } from '@/features/agent-calls/call-card';
import { threadGraphId } from '@/features/agent-calls/threads';
import { useCalls } from '@/features/agent-calls/use-calls';
import { AGENTS, getAgent } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

/**
 * `CallCard`'s shape while the thread list loads — kept directly beneath it so the two are
 * edited together.
 *
 * Mirrors the card above field for field, because the previous version did not and every row
 * moved on fill: it drew TWO text bars where the card renders three lines (title+badge,
 * descriptor, relative time), used `gap-1.5` against the card's `gap-1`, and ended in a wide
 * pill where the card ends in a narrow chevron — while omitting the status badge, which is the
 * thing that actually is a pill, inline beside the title.
 *
 * Eight rows rather than three: three left most of the screen empty and then reflowed as ~20
 * real rows arrived.
 */
function CallListSkeleton() {
  return (
    <View className="gap-3">
      {Array.from({ length: 8 }, (_, i) => (
        <Card key={i} tone="sticker" className="flex-row items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-crumb" />
          <View className="flex-1 gap-1">
            {/* Line BOXES, not bar heights — measured off the rendered card: the title line
                is 28px (text-lg), the descriptor 20px (text-sm), the timestamp 16px
                (text-xs). Sizing these to the bars instead left the card 86px against a
                real 108px, so every row grew by 22px on fill. */}
            <View className="h-7 flex-row items-center gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-12 rounded-pill" />
            </View>
            <View className="h-5 justify-center">
              <Skeleton className="h-3.5 w-24" />
            </View>
            <View className="h-4 justify-center">
              <Skeleton className="h-3 w-16" />
            </View>
          </View>
          <Skeleton className="h-5 w-2.5" />
        </Card>
      ))}
    </View>
  );
}

const Separator = () => <View className="h-3" />;

export default function CallsScreen() {
  const router = useRouter();
  const { data: threads, isLoading, isError, error, refetch, isRefetching } = useCalls();
  const [filter, setFilter] = useState<string>('all'); // 'all' | graphId | 'other'

  // Pull to load the latest runs. `searchThreads` is already `created_at desc`,
  // so a refetch puts a just-finished run at the top. The same control is handed
  // to BOTH render paths below — the list, and the plain `Screen` that the empty
  // and error states use — because "pull the calls page" has to mean one thing.
  const refreshControl = (
    <RefreshControl
      refreshing={isRefetching}
      onRefresh={refetch}
      tintColor={palette.frosting[500]}
      colors={[palette.frosting[500]]}
      progressBackgroundColor={palette.white}
    />
  );

  // Open into the agent's own screen (resumes chat / reopens the saved result).
  // Threads from an unknown/legacy agent fall back to the read-only detail page.
  const openThread = (thread: Thread) => openThreadRoute(router, thread);

  // Which agents actually appear in the list → build the filter chips + counts.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of threads ?? []) {
      const id = threadGraphId(t);
      const key = id && getAgent(id) ? id : 'other';
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [threads]);

  const visible = (threads ?? []).filter((t) => {
    if (filter === 'all') return true;
    const id = threadGraphId(t);
    const key = id && getAgent(id) ? id : 'other';
    return key === filter;
  });

  const filterChips = [
    { key: 'all', label: 'All' },
    ...AGENTS.filter((a) => counts[a.id]).map((a) => ({ key: a.id, label: a.title })),
    ...(counts.other ? [{ key: 'other', label: 'Other' }] : []),
  ];

  const header = (
    <View className="pb-4">
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
    </View>
  );

  // Loading / error / empty render in the plain scroll layout — the FlashList
  // only ever mounts with rows (its ListEmptyComponent doesn't reliably update
  // in-place on web, verified in the M18 smoke test).
  if (isLoading || isError || visible.length === 0) {
    return (
      <Screen plaid refreshControl={refreshControl}>
        {header}
        {isLoading ? <CallListSkeleton /> : isError ? (
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
        ) : (
          <Card tone="muted">
            <Text variant="muted">No calls for this filter.</Text>
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen scroll={false} plaid contentClassName="pb-0">
      {/* Virtualized — the list can hold up to 50 rich cards (searchThreads limit). */}
      <FlashList
        data={visible}
        keyExtractor={(t) => t.thread_id}
        renderItem={({ item }) => <CallCard thread={item} onOpen={openThread} />}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={refreshControl}
      />
    </Screen>
  );
}
