/**
 * The app's donut. One implementation, `d3-shape` for the geometry.
 *
 * `sector-pie.tsx` hand-rolled polar/arc maths; this replaces it so there is a single donut rather
 * than one per screen. d3-shape handles the cases hand-rolled arc code gets wrong — a slice larger
 * than a semicircle needs the large-arc flag, and a slice at exactly 100% degenerates to a zero
 * length path unless it is drawn as a full ring.
 *
 * **`.sort(null)` IS LOAD-BEARING.** d3's `pie()` sorts by value descending BY DEFAULT, which would
 * silently reorder the caller's slices — so the legend's third entry would colour the chart's first
 * wedge. The caller decides the order; a segment breakdown is already sorted by size and a P&L is
 * sorted semantically.
 *
 * The spin-in is a container transform, not an animated arc — see `animate.ts` for why.
 */
import { useMemo } from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';
import { arc as d3arc, pie as d3pie } from 'd3-shape';

import { chartColors, palette } from '@/theme/colors';

import { useEntrance } from './animate';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface DonutProps {
  slices: DonutSlice[];
  size?: number;
  /** Ring thickness as a fraction of the radius. */
  thickness?: number;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  /** Big text in the hole — usually the selected slice's share, or the dimension's name. */
  centerPrimary?: string;
  centerSecondary?: string;
  /** Restarts the spin when the subject changes. */
  animationKey?: string | number;
  /**
   * An optional label drawn INSIDE a wedge. Return null to omit it — the sector donut labels only
   * slices at 6% or more, because a wedge narrower than its own text renders as overlapping noise.
   */
  sliceLabel?: (slice: DonutSlice, sharePct: number) => string | null;
  /** Ring gap colour; the sector donut separates wedges against the page rather than the surface. */
  gap?: string;
}

export function Donut({
  slices,
  size = 200,
  thickness = 0.42,
  selectedKey = null,
  onSelect,
  centerPrimary,
  centerSecondary,
  animationKey = 0,
  sliceLabel,
  gap,
}: DonutProps) {
  const progress = useEntrance(`${animationKey}:${slices.length}`);

  // Rotate in and settle. `-24deg` rather than a full turn: at 620ms a whole rotation reads as a
  // loading spinner, which is the one thing this must not be mistaken for.
  const spin = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ rotate: `${-24 * (1 - progress.value)}deg` }, { scale: 0.9 + 0.1 * progress.value }],
  }));

  const { wedges, total } = useMemo(() => {
    // A negative value has no angle to occupy. Segment profit genuinely goes negative — a
    // loss-making division — and a donut cannot draw it, so it is excluded here and the caller
    // says so in words rather than the chart implying the division does not exist.
    const usable = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
    const sum = usable.reduce((a, s) => a + s.value, 0);
    const layout = d3pie<DonutSlice>()
      .value((d) => d.value)
      .sort(null)
      .padAngle(0.014)(usable);
    return { wedges: layout, total: sum };
  }, [slices]);

  if (wedges.length === 0 || total <= 0) return null;

  const r = size / 2;
  const inner = r * (1 - thickness);
  const shape = d3arc<(typeof wedges)[number]>().innerRadius(inner).cornerRadius(2);

  return (
    <Animated.View style={spin} className="items-center">
      <Svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`}>
        <G>
          {wedges.map((w, i) => {
            const selected = w.data.key === selectedKey;
            const dimmed = selectedKey !== null && !selected;
            const outer = selected ? r : r * 0.94;
            const d = shape.outerRadius(outer)(w);
            const share = (w.data.value / total) * 100;
            const text = sliceLabel?.(w.data, share) ?? null;
            const mid = (w.startAngle + w.endAngle) / 2 - Math.PI / 2;
            const lr = (outer + inner) / 2;
            return (
              <G
                key={w.data.key}
                onPress={onSelect ? () => onSelect(selected ? null : w.data.key) : undefined}>
                <Path
                  d={d ?? undefined}
                  fill={w.data.color ?? chartColors.sector[i % chartColors.sector.length]}
                  opacity={dimmed ? 0.35 : 1}
                  stroke={gap}
                  strokeWidth={gap ? 2.5 : undefined}
                />
                {text ? (
                  <SvgText
                    x={Math.cos(mid) * lr}
                    y={Math.sin(mid) * lr + 4}
                    fontSize={12}
                    fontWeight="bold"
                    textAnchor="middle"
                    fill={palette.white}
                    opacity={dimmed ? 0.35 : 1}>
                    {text}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </G>
        {centerPrimary ? (
          <SvgText
            x={0}
            y={centerSecondary ? -2 : 5}
            fontSize={17}
            fontWeight="bold"
            textAnchor="middle"
            fill={palette.frosting[700]}>
            {centerPrimary}
          </SvgText>
        ) : null}
        {centerSecondary ? (
          <SvgText x={0} y={16} fontSize={11} textAnchor="middle" fill={palette.inkMuted}>
            {centerSecondary}
          </SvgText>
        ) : null}
      </Svg>
    </Animated.View>
  );
}
