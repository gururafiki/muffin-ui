import { useState } from 'react';
import { View } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

import { palette } from '@/theme/colors';
import { SECTORS, SECTOR_WEIGHTS, type Sector } from './taxonomy';

// Categorical palette harmonised with the brand grape/blueberry + butter accents.
const SLICE_COLORS = [
  '#875DAE', '#A47EC6', '#6E63A6', '#524785', '#C2A4DC', '#6F4A93',
  '#9B7BC4', '#E9A94D', '#B79AD8', '#7FB35C', '#5A3C77',
];

const SIZE = 240;
const C = SIZE / 2;
const R = 100;
const R_SEL = 110; // selected slice pops out
const INNER = 56; // donut hole

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arc(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number) {
  const large = end - start > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, end);
  const o2 = polar(cx, cy, rOuter, start);
  const i1 = polar(cx, cy, rInner, start);
  const i2 = polar(cx, cy, rInner, end);
  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 0 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 1 ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

interface Slice {
  sector: Sector;
  start: number;
  end: number;
  color: string;
  weight: number;
}

function buildSlices(): Slice[] {
  const total = SECTORS.reduce((s, sec) => s + (SECTOR_WEIGHTS[sec.id] ?? 1), 0);
  let angle = 0;
  return SECTORS.map((sector, i) => {
    const weight = SECTOR_WEIGHTS[sector.id] ?? 1;
    const sweep = (weight / total) * 360;
    const slice = { sector, start: angle, end: angle + sweep, color: SLICE_COLORS[i % SLICE_COLORS.length], weight };
    angle += sweep;
    return slice;
  });
}

/** Interactive donut of sector weights. Tap a slice to select it. */
export function SectorPie({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [slices] = useState(buildSlices);
  const selected = slices.find((s) => s.sector.id === selectedId);

  return (
    <View className="items-center">
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {slices.map((s) => {
          const isSel = s.sector.id === selectedId;
          const mid = (s.start + s.end) / 2;
          const labelPos = polar(C, C, (isSel ? R_SEL : R) - 28, mid);
          return (
            <G key={s.sector.id} onPress={() => onSelect(s.sector.id)} opacity={isSel || !selectedId ? 1 : 0.5}>
              <Path
                d={arc(C, C, isSel ? R_SEL : R, INNER, s.start, s.end)}
                fill={s.color}
                stroke={palette.dough}
                strokeWidth={2.5}
              />
              {s.weight >= 6 ? (
                <SvgText
                  x={labelPos.x}
                  y={labelPos.y + 5}
                  fontSize={13}
                  fontWeight="bold"
                  textAnchor="middle"
                  fill="#FFFFFF">
                  {s.weight}%
                </SvgText>
              ) : null}
            </G>
          );
        })}
        {/* Center label */}
        <SvgText x={C} y={C - 4} fontSize={14} fontWeight="bold" textAnchor="middle" fill={palette.frosting[700]}>
          {selected ? selected.sector.name.split(' ')[0] : 'Sectors'}
        </SvgText>
        <SvgText x={C} y={C + 15} fontSize={12} textAnchor="middle" fill="#7A6A92">
          {selected ? `${selected.weight}% wt` : 'tap a slice'}
        </SvgText>
      </Svg>
    </View>
  );
}
