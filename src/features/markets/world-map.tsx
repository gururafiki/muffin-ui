import { useMemo } from 'react';
import { useColorScheme, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { mapColors, palette } from '@/theme/colors';
import {
  UNCLASSIFIED_COLOR,
  type LensId,
  type Scheme,
} from './classification';
import { viewBoxForIsos } from './geo-utils';
import { WORLD_GEO, WORLD_VIEWBOX } from './world-geo';

/**
 * Interactive world map. Colours every country by the selected classification
 * scheme + lens (region / market tier). Optionally zooms to and isolates a
 * single group (region screen). Tapping a country selects it.
 */
export function WorldMap({
  scheme,
  lens,
  focusGroup,
  selectedIso,
  onSelectCountry,
}: {
  /** A RESOLVED scheme, not an id — the caller owns whether it came from the
   *  server (`useScheme`) or the bundled fallback, so this stays presentational. */
  scheme: Scheme;
  lens: LensId;
  /** Zoom to this group and dim everything else. */
  focusGroup?: string;
  selectedIso?: string | null;
  onSelectCountry?: (iso: string) => void;
}) {
  const dark = useColorScheme() === 'dark';

  const { fills, groups, viewBox } = useMemo(() => {
    const fills: Record<string, string> = {};
    const groups: Record<string, string | undefined> = {};
    const focusIsos: string[] = [];
    for (const c of WORLD_GEO) {
      const gid = scheme.groupOf(lens, c.iso);
      groups[c.iso] = gid;
      const g = gid ? scheme.groups[lens].find((x) => x.id === gid) : undefined;
      fills[c.iso] = g?.color ?? UNCLASSIFIED_COLOR;
      if (focusGroup && gid === focusGroup) focusIsos.push(c.iso);
    }
    const viewBox = focusGroup && focusIsos.length ? viewBoxForIsos(focusIsos) : WORLD_VIEWBOX;
    return { fills, groups, viewBox };
  }, [scheme, lens, focusGroup]);

  const ocean = dark ? palette.night.surface : mapColors.ocean;
  const stroke = dark ? palette.night.bg : palette.dough;
  const dim = dark ? palette.night.surfaceMuted : mapColors.dim;

  return (
    <View
      className="overflow-hidden rounded-bun border-2 border-ink/10 dark:border-night-border"
      style={{ width: '100%', aspectRatio: 2000 / 857, backgroundColor: ocean }}>
      <Svg width="100%" height="100%" viewBox={viewBox}>
        {WORLD_GEO.map((c) => {
          const inFocus = !focusGroup || groups[c.iso] === focusGroup;
          const isSel = selectedIso === c.iso;
          const fill = !inFocus ? dim : fills[c.iso];
          return (
            <Path
              key={c.iso}
              d={c.d}
              fill={isSel ? palette.frosting[700] : fill}
              stroke={isSel ? palette.ink : stroke}
              strokeWidth={isSel ? 1.4 : 0.5}
              opacity={inFocus ? 1 : 0.55}
              onPress={onSelectCountry && inFocus ? () => onSelectCountry(c.iso) : undefined}
            />
          );
        })}
      </Svg>
    </View>
  );
}
