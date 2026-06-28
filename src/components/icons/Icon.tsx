/**
 * <Icon /> — the single icon facade used everywhere in the app.
 *
 * Renders a custom doodle SVG if one is registered for `name`, otherwise the
 * Phosphor glyph from the registry. Default weight is `duotone` for the
 * two-tone "sticker" bakery look; pass `weight="bold"`/`"fill"` for emphasis.
 */
import type { IconWeight } from 'phosphor-react-native';

import { palette } from '@/theme/colors';
import { customRegistry } from './custom';
import { iconRegistry, type IconName } from './registry';

export type IconProps = {
  name: IconName;
  size?: number;
  /** Outline / primary color. Duotone fill is derived from it unless overridden. */
  color?: string;
  weight?: IconWeight;
  /** Override the duotone secondary (fill) color. */
  duotoneColor?: string;
  duotoneOpacity?: number;
};

export function Icon({
  name,
  size = 24,
  color = palette.frosting[600],
  weight = 'duotone',
  duotoneColor,
  duotoneOpacity,
}: IconProps) {
  const Custom = customRegistry[name];
  if (Custom) return <Custom size={size} color={color} />;

  const Glyph = iconRegistry[name];
  return (
    <Glyph
      size={size}
      color={color}
      weight={weight}
      duotoneColor={duotoneColor}
      duotoneOpacity={duotoneOpacity}
    />
  );
}

export type { IconName };
