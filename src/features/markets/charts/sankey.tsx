/**
 * The income statement as a Sankey — revenue in from the left, profit and cost out to the right.
 *
 * Geometry is in `sankey-layout.ts` (pure, asserted offline by `scripts/income-flow-check.ts`); this
 * file only draws it. The chart DEGRADES rather than disappearing: 8,949 securities have the
 * statement half and 66 additionally disclose revenue streams, so the streams column is simply
 * absent for most companies and the waterfall stands alone.
 *
 * INTERACTION IS TAP-TO-HIGHLIGHT AND NOTHING ELSE. Tapping a node dims everything not connected to
 * it and reveals its value, share and Y/Y. No drag, no pinch, no zoom: this is a bespoke diagram
 * with at most ~20 nodes, and gestures here would cost real complexity to buy a reader nothing.
 *
 * A DERIVED NODE SAYS SO. Cost of sales and operating costs are subtractions, not reported lines —
 * marked with a dot and footnoted, because a reader who takes them for filed figures would be
 * wrong about what the company published.
 */
import { useMemo, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { palette } from '@/theme/colors';

import type { FlowLink, FlowNode } from '../income-flow';
import { formatMoney } from '../money';
import { useEntrance } from './animate';
import { layoutFlow, type PlacedNode } from './sankey-layout';

const NODE_W = 11;
const LABEL_GAP = 7;
/** Room for the labels that sit outside the plotted band, left and right. */
const PAD_L = 96;
const PAD_R = 104;

const TONE = {
  revenue: palette.frosting[500],
  profit: palette.bullish,
  cost: palette.bearish,
} as const;

function shortMoney(v: number, currency: string | null): string {
  return formatMoney(v, currency);
}

export function IncomeSankey({
  nodes,
  links,
  currency,
  width,
  height = 300,
  animationKey,
}: {
  nodes: FlowNode[];
  links: FlowLink[];
  currency: string | null;
  width: number;
  height?: number;
  animationKey?: string | number;
}) {
  const dark = useColorScheme() === 'dark';
  const [selected, setSelected] = useState<string | null>(null);
  const progress = useEntrance(`${animationKey ?? ''}:${nodes.length}`);

  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const layout = useMemo(
    () => layoutFlow(nodes, links, { width: plotW, height, nodeWidth: NODE_W }),
    [nodes, links, plotW, height],
  );

  // Fade and slide in from the left, the direction the flow reads.
  const entrance = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: -14 * (1 - progress.value) }],
  }));

  if (layout.nodes.length === 0) return null;

  // What the selection connects to, one hop each way — enough to follow a stage without lighting
  // up the whole diagram, which would defeat the point of dimming.
  const related = new Set<string>();
  if (selected) {
    related.add(selected);
    for (const l of layout.links) {
      if (l.from === selected) related.add(l.to);
      if (l.to === selected) related.add(l.from);
    }
  }
  const lit = (key: string) => !selected || related.has(key);
  const litLink = (l: { from: string; to: string }) =>
    !selected || l.from === selected || l.to === selected;

  const node = layout.nodes.find((n) => n.key === selected) ?? null;
  const trunk = layout.nodes.find((n) => n.key === 'revenue')?.value ?? 0;
  const lastColumn = Math.max(...layout.nodes.map((n) => n.column));
  const textFill = dark ? palette.night.text : palette.ink;
  const mutedFill = dark ? palette.night.textMuted : palette.inkMuted;

  const label = (n: PlacedNode) => {
    // Labels sit outside the band at the two ends and inside it between, so the diagram uses its
    // full width instead of reserving gutters at every column.
    const first = n.column === 0;
    const last = n.column === lastColumn;
    const x = first ? n.x0 - LABEL_GAP : last ? n.x1 + LABEL_GAP : n.x1 + LABEL_GAP;
    const anchor: 'end' | 'start' = first ? 'end' : 'start';
    const y = (n.y0 + n.y1) / 2;
    // TWO LABEL TIERS, BECAUSE A SANKEY'S HEIGHTS ARE PROPORTIONAL TO REVENUE AND MOST P&L LINES
    // ARE NOT. Income tax is ~5% of revenue, so its block is ~12px on a 260px chart — under a
    // single 22px gate it drew a labelled diagram with the tax block silently blank, which is a
    // major line the reader is looking for. Verified live: unlabelled for both Apple and Amazon.
    // Stacked name + value where there is room, one compact line where there is not, nothing at all
    // below ~9px where any text would collide with its neighbour.
    const h = n.y1 - n.y0;
    const tier: 'stacked' | 'inline' | 'none' = h >= 22 ? 'stacked' : h >= 9 ? 'inline' : 'none';
    return { x, y, anchor, tier };
  };

  return (
    <View>
      <Animated.View style={entrance}>
        <Svg width={width} height={height}>
          <G x={PAD_L} y={0}>
            {layout.links.map((l) => {
              const target = layout.nodes.find((n) => n.key === l.to);
              return (
                <Path
                  key={`${l.from}->${l.to}`}
                  d={l.path}
                  fill="none"
                  stroke={TONE[target?.tone ?? 'revenue']}
                  strokeWidth={l.width}
                  strokeOpacity={litLink(l) ? 0.3 : 0.07}
                />
              );
            })}
            {layout.nodes.map((n) => {
              const pos = label(n);
              const on = lit(n.key);
              return (
                <G key={n.key} onPress={() => setSelected(selected === n.key ? null : n.key)}>
                  <Rect
                    x={n.x0}
                    y={n.y0}
                    width={Math.max(1, n.x1 - n.x0)}
                    height={Math.max(1, n.y1 - n.y0)}
                    rx={2.5}
                    fill={TONE[n.tone]}
                    opacity={on ? 1 : 0.28}
                  />
                  {pos.tier === 'stacked' ? (
                    <>
                      <SvgText
                        x={pos.x}
                        y={pos.y - 1}
                        fontSize={10.5}
                        fontWeight={n.key === 'revenue' ? 'bold' : 'normal'}
                        textAnchor={pos.anchor}
                        fill={on ? textFill : mutedFill}
                        opacity={on ? 1 : 0.5}>
                        {n.label}
                        {n.derived ? ' ·' : ''}
                      </SvgText>
                      <SvgText
                        x={pos.x}
                        y={pos.y + 11}
                        fontSize={9.5}
                        textAnchor={pos.anchor}
                        fill={mutedFill}
                        opacity={on ? 1 : 0.5}>
                        {shortMoney(n.value, currency)}
                      </SvgText>
                    </>
                  ) : pos.tier === 'inline' ? (
                    <SvgText
                      x={pos.x}
                      y={pos.y + 3.5}
                      fontSize={9.5}
                      textAnchor={pos.anchor}
                      fill={on ? textFill : mutedFill}
                      opacity={on ? 1 : 0.5}>
                      {n.label}
                      {n.derived ? ' ·' : ''} {shortMoney(n.value, currency)}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </G>
        </Svg>
      </Animated.View>

      {/* The readout, below rather than floating: a tooltip over a diagram this dense hides the
          thing it describes, and on touch the finger is already covering that area. */}
      <View className="mt-1 min-h-[34px] flex-row items-center justify-between gap-2">
        {node ? (
          <>
            <Text variant="body" className="shrink">
              {node.label}
              {node.derived ? ' (derived)' : ''}
            </Text>
            <Text variant="muted" className="shrink-0">
              {shortMoney(node.value, currency)}
              {trunk > 0 && node.key !== 'revenue' ? ` · ${((node.value / trunk) * 100).toFixed(1)}% of revenue` : ''}
              {node.yoy !== null ? ` · ${node.yoy >= 0 ? '+' : ''}${(node.yoy * 100).toFixed(1)}% y/y` : ''}
            </Text>
          </>
        ) : (
          <Text variant="muted">Tap a block to follow it through the statement.</Text>
        )}
      </View>
      {layout.nodes.some((n) => n.derived) ? (
        <Text variant="muted" className="mt-0.5 text-[11px]">
          · derived by subtraction, not a reported line
        </Text>
      ) : null}
    </View>
  );
}
