import { View } from 'react-native';

import { Card, Skeleton, Text } from '@/components/ui';
import { COUNCIL_PERSONAS, type PersonaMeta } from './personas';
import { PersonaAvatar } from './persona-avatar';
import type { PersonaSignal, PersonaStage } from './types';

/**
 * The arena: the sitting members (13 personas, +6 specialists when the run
 * includes them), live-animated as the debate unfolds.
 */
export function CouncilArena({
  members,
  stages,
  signals,
  selected,
  onSelect,
  active,
}: {
  members: PersonaMeta[];
  stages: Record<string, PersonaStage>;
  signals: Record<string, PersonaSignal>;
  selected: string | null;
  onSelect: (slug: string) => void;
  active: boolean;
}) {
  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="heading">The Council</Text>
        <Text variant="muted">{active ? 'in session' : 'tap an avatar'}</Text>
      </View>
      <View className="flex-row flex-wrap justify-center gap-y-3">
        {members.map((meta) => (
          <PersonaAvatar
            key={meta.slug}
            meta={meta}
            stage={stages[meta.slug] ?? 'pending'}
            signal={signals[meta.slug]}
            selected={selected === meta.slug}
            onPress={() => onSelect(meta.slug)}
          />
        ))}
      </View>
    </Card>
  );
}

/**
 * The arena's shape while a reopened session hydrates.
 *
 * Lives next to `CouncilArena` so the two stay in step — the seat metrics below mirror
 * `PersonaAvatar` (`w-[88px]`, a 64px avatar, a label line) and the wrapper mirrors the grid
 * above. It seats `COUNCIL_PERSONAS` because that is what the screen renders before it knows
 * whether specialists took part; their six extra seats join later, as they do in a live run.
 *
 * This replaced a single `h-24` (96px) bar. The real arena is ~4 rows of ~96px seats, so
 * hydration used to grow the page by roughly 500px and shove everything below it down.
 */
export function CouncilArenaSkeleton() {
  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="heading">The Council</Text>
        <Skeleton className="h-3.5 w-20" />
      </View>
      <View className="flex-row flex-wrap justify-center gap-y-3">
        {COUNCIL_PERSONAS.map((meta) => (
          <View key={meta.slug} className="w-[88px] items-center gap-1">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-2.5 w-14" />
          </View>
        ))}
      </View>
    </Card>
  );
}
