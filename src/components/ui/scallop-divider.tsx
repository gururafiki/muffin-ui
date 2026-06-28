import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { palette } from '@/theme/colors';

/**
 * Wavy scalloped band — the divider motif from the bakery reference. A colored
 * strip whose edge is a row of bumps; place at the bottom of a colored header
 * (edge="bottom", default) or the top of a footer (edge="top").
 */
export function ScallopDivider({
  color = palette.frosting[700],
  height = 18,
  scallops = 14,
  edge = 'bottom',
}: {
  color?: string;
  height?: number;
  scallops?: number;
  edge?: 'top' | 'bottom';
}) {
  const w = 100;
  const r = w / (scallops * 2);

  // A row of `scallops` semicircles, drawn right→left along the bumpy edge.
  // sweep 1 bulges down (bottom edge); sweep 0 bulges up (top edge).
  const bumps = (sweep: 0 | 1) =>
    Array.from({ length: scallops }, () => `a ${r} ${r} 0 0 ${sweep} ${-2 * r} 0`).join(' ');

  const d =
    edge === 'bottom'
      ? `M0 0 H ${w} V ${height - r} ${bumps(1)} Z`
      : `M0 ${height} H ${w} V ${r} ${bumps(0)} Z`;

  return (
    <View style={{ height }} className="w-full">
      <Svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
        <Path d={d} fill={color} />
      </Svg>
    </View>
  );
}
