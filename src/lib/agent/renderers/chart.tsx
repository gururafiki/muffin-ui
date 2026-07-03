import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';

import { Text } from '@/components/ui';
import { palette } from '@/theme/colors';

import type { SeriesPoint, TimeSeries } from './chart-data';

const LINE_COLORS = [palette.frosting[500], palette.butter[500], palette.leaf[500]];
const HEIGHT = 160;
const PAD_Y = 6;
/** Bottom fraction of the chart reserved for the volume bars. */
const BAR_BAND = 0.22;

function formatValue(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(a >= 100 ? 1 : 2);
}

function domain(points: SeriesPoint[][], pick: (p: SeriesPoint) => number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const series of points)
    for (const p of series) {
      const v = pick(p);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return [min, max];
}

/**
 * A lightweight time-series chart (SVG): one or more lines over an optional
 * volume bar band, with min/max y labels, start/end x labels and a legend.
 * Fed by `parseTimeSeries` — the renderer for price-history / indicator tool
 * outputs.
 */
export function TimeSeriesChart({ data }: { data: TimeSeries }) {
  const [width, setWidth] = useState(0);
  const allPoints = data.lines.map((l) => l.points);
  const [x0, x1] = domain(allPoints, (p) => p.x);
  const [y0, y1] = domain(allPoints, (p) => p.y);
  const plotH = HEIGHT - PAD_Y * 2;
  const px = (x: number) => ((x - x0) / (x1 - x0)) * width;
  const py = (y: number) => PAD_Y + (1 - (y - y0) / (y1 - y0)) * plotH;

  const bars = data.bars;
  const barMax = bars ? Math.max(...bars.points.map((p) => p.y), 1) : 1;
  const barW = bars ? Math.max(1, width / bars.points.length - 1) : 0;

  return (
    <View className="gap-1.5">
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        {data.lines.map((l, i) => (
          <View key={l.label} className="flex-row items-center gap-1.5">
            <View style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }} className="h-2.5 w-2.5 rounded-pill" />
            <Text variant="muted" className="text-xs">
              {l.label} · {formatValue(l.points[l.points.length - 1].y)}
            </Text>
          </View>
        ))}
        {bars ? (
          <View className="flex-row items-center gap-1.5">
            <View className="h-2.5 w-2.5 rounded-[3px] bg-frosting-200 dark:bg-night-surface-muted" />
            <Text variant="muted" className="text-xs">{bars.label}</Text>
          </View>
        ) : null}
      </View>

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {[0, 0.5, 1].map((f) => (
              <Line
                key={f}
                x1={0}
                x2={width}
                y1={PAD_Y + f * plotH}
                y2={PAD_Y + f * plotH}
                stroke={palette.frosting[200]}
                strokeOpacity={0.5}
                strokeWidth={1}
              />
            ))}
            {bars
              ? bars.points.map((p, i) => {
                  const h = (p.y / barMax) * plotH * BAR_BAND;
                  return (
                    <Rect
                      key={i}
                      x={px(p.x) - barW / 2}
                      y={HEIGHT - PAD_Y - h}
                      width={barW}
                      height={h}
                      fill={palette.frosting[300]}
                      opacity={0.35}
                    />
                  );
                })
              : null}
            {data.lines.map((l, i) => (
              <Polyline
                key={l.label}
                points={l.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
                fill="none"
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ))}
          </Svg>
        ) : null}
        <Text variant="muted" className="absolute right-0 top-0 text-[10px]">{formatValue(y1)}</Text>
        <Text variant="muted" className="absolute bottom-0 right-0 text-[10px]">{formatValue(y0)}</Text>
      </View>

      <View className="flex-row justify-between">
        <Text variant="muted" className="text-[10px]">{data.startLabel}</Text>
        <Text variant="muted" className="text-[10px]">{data.endLabel}</Text>
      </View>
    </View>
  );
}
