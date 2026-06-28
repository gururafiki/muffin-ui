/**
 * Custom SVG icons — the extension point for hand-styled / downloaded doodles.
 *
 * How to add or override an icon (e.g. a cartoon glyph from svgrepo.com):
 *   1. Save the `.svg` in this folder, e.g. `muffin.svg`. Prefer SVGs whose
 *      strokes/fills use `currentColor` so they pick up the icon color.
 *   2. Import it and register it below under the desired name:
 *        import MuffinSvg from './muffin.svg';
 *        export const customRegistry = { muffin: customIcon(MuffinSvg) };
 *   3. Done — every <Icon name="muffin" /> now renders your SVG. If the name
 *      already exists in the Phosphor registry, this transparently overrides it
 *      with zero changes at any call site.
 *
 * SVGs import as React components via react-native-svg-transformer (see
 * metro.config.js + global.d.ts).
 */
import type React from 'react';
import type { SvgProps } from 'react-native-svg';

export type CustomIconProps = { size?: number; color?: string };

/** Adapt an imported SVG component to the uniform { size, color } icon shape. */
export function customIcon(Svg: React.FC<SvgProps>): React.FC<CustomIconProps> {
  return function CustomIcon({ size = 24, color }: CustomIconProps) {
    return <Svg width={size} height={size} color={color} fill={color} />;
  };
}

/**
 * Custom icons keyed by name. Keys here override the Phosphor registry of the
 * same name. Empty by default — add entries as custom art lands.
 */
export const customRegistry: Record<string, React.FC<CustomIconProps>> = {};
