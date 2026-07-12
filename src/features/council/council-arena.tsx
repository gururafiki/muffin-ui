import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import type { PersonaMeta } from './personas';
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
