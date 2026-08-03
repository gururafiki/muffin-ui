import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { palette } from '@/theme/colors';

/**
 * Muffin mascot — a kawaii blueberry muffin: golden top, cream liner with
 * pleats, blueberries and a leaf, all with a thick "ink" doodle outline to
 * match the bakery reference. Drawn with SVG so it scales crisply everywhere.
 */
export function MuffinLogo({ size = 64 }: { size?: number }) {
  const ink = palette.ink;
  const stroke = 2.4;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* ground shadow */}
      <Ellipse cx="32" cy="57" rx="17" ry="2.6" fill={ink} opacity={0.08} />

      {/* liner / cup */}
      <Path
        d="M18 34 H46 L42.5 52.5 A3 3 0 0 1 39.6 55 H24.4 A3 3 0 0 1 21.5 52.5 Z"
        fill={palette.crust}
        stroke={ink}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
      {/* liner pleats — stop short of the cup's bottom curve. The original
          lengths pierced the outline; invisible at 48px here, but this mark is
          also rendered at 1024px for the app icons (scripts/generate-icons.mjs,
          which mirrors this file). */}
      <Path
        d="M27 35.5 26 50 M32 35.5 V51.5 M37 35.5 38 50"
        stroke="#D9C7A8"
        strokeWidth={1.6}
        strokeLinecap="round"
      />

      {/* muffin top — a bumpy dome overhanging the cup */}
      <Path
        d="M15.5 35
           C13 22 21 13.5 32 13.5
           C43 13.5 51 22 48.5 35
           C46 33.5 43 34.5 41 36
           C37.5 33.8 26.5 33.8 23 36
           C21 34.5 18 33.5 15.5 35 Z"
        fill={palette.butter[500]}
        stroke={ink}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />

      {/* blueberries */}
      <Circle cx="24" cy="26" r="3.1" fill={palette.blueberry[500]} stroke={ink} strokeWidth={1.6} />
      <Circle cx="32.5" cy="22" r="3.4" fill={palette.blueberry[400]} stroke={ink} strokeWidth={1.6} />
      <Circle cx="41" cy="27" r="3.1" fill={palette.blueberry[500]} stroke={ink} strokeWidth={1.6} />
      {/* berry highlights */}
      <Circle cx="23" cy="25" r="0.8" fill="#FFFFFF" opacity={0.7} />
      <Circle cx="31.4" cy="20.9" r="0.9" fill="#FFFFFF" opacity={0.7} />
      <Circle cx="40" cy="26" r="0.8" fill="#FFFFFF" opacity={0.7} />

      {/* leaf */}
      <Path
        d="M37 16 C40 11 46 11 48 13 C46 18 40 18 37 16 Z"
        fill={palette.leaf[500]}
        stroke={ink}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
