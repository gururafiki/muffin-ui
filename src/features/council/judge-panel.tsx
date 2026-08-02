import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

import { Icon } from '@/components/icons';
import { Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { CouncilVerdictCard, StructuredOutput } from '@/lib/agent/renderers';

const KNOWN = new Set([
  'consensus_rating',
  'weighted_confidence',
  'vote_breakdown',
  'bull_case_synthesis',
  'bear_case_synthesis',
  'dissent_summary',
  'key_uncertainties',
  'reasoning',
]);

/** The judge: deliberating shimmer, then the council's synthesised verdict. */
export function JudgePanel({
  synthesis,
  judging,
}: {
  synthesis: Record<string, unknown> | null;
  judging: boolean;
}) {
  const shimmer = useSharedValue(0);
  useEffect(() => {
    if (judging) shimmer.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    else shimmer.value = 0;
  }, [judging, shimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: 0.5 + shimmer.value * 0.5 }));

  if (judging) {
    return (
      <Card tone="muted" className="items-center gap-2 py-6">
        <Animated.View style={shimmerStyle}>
          <Icon name="council" size={44} color={palette.frosting[500]} />
        </Animated.View>
        <Text variant="heading">The judge is deliberating…</Text>
        <Text variant="muted">Weighing 13 verdicts into a consensus.</Text>
      </Card>
    );
  }

  if (!synthesis) return null;

  // The verdict body is the SAME card the timeline renders for `council_synthesis`, so
  // the two views cannot drift. It replaces a hand-rolled panel that showed the vote
  // breakdown as a nested key/value dump rather than a proportional bar, and rendered
  // the bull/bear/dissent prose as plain `Text` instead of markdown.
  const verdict = CouncilVerdictCard({ value: synthesis });
  const extras = Object.fromEntries(
    Object.entries(synthesis).filter(([k, v]) => !KNOWN.has(k) && v != null),
  );

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <Icon name="council" size={24} color={palette.frosting[600]} />
        <Text variant="heading">Council Verdict</Text>
      </View>
      {verdict ?? <StructuredOutput value={synthesis} />}
      {Object.keys(extras).length > 0 ? <StructuredOutput value={extras} /> : null}
    </View>
  );
}
