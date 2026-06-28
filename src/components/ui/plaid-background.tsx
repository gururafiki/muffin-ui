import { useColorScheme, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { palette } from '@/theme/colors';

/**
 * Subtle lavender gingham / plaid backdrop — the signature texture from the
 * blueberry-bakery reference. Renders as an absolutely-positioned fill behind
 * screen content; pass via <Screen plaid> or drop in directly.
 */
export function PlaidBackground({ opacity = 1 }: { opacity?: number }) {
  const dark = useColorScheme() === 'dark';
  const base = dark ? palette.night.bg : palette.plaid.base;
  const line = dark ? palette.night.surface : palette.plaid.line;
  const size = 28;

  return (
    <View style={{ position: 'absolute', inset: 0, opacity }} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="plaid" width={size} height={size} patternUnits="userSpaceOnUse">
            <Rect width={size} height={size} fill={base} />
            {/* two translucent bands per axis → woven gingham look */}
            <Rect width={size} height={size / 2} fill={line} opacity={0.55} />
            <Rect width={size / 2} height={size} fill={line} opacity={0.35} />
            <Rect width={size / 2} height={size / 2} fill={line} opacity={0.5} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#plaid)" />
      </Svg>
    </View>
  );
}
