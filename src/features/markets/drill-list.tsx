import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { changeTone } from './taxonomy';

export interface DrillItem {
  key: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
  leading?: string; // flag glyph (countries)
  changePct?: number;
  tag?: string;
  /**
   * No drill-down target: the row renders as plain content, without the chevron and without being
   * pressable.
   *
   * A security whose US ticker has not been resolved has no stock page to open — most non-US
   * listings have none at all. A chevron on such a row promises a destination that does not
   * exist, and a `Pressable` that does nothing reads as a broken tap.
   */
  disabled?: boolean;
}

const toneColor = { bullish: palette.bullish, bearish: palette.bearish, neutral: palette.neutral };

/** Tappable rows to the next drill-down level. */
export function DrillList({
  items,
  onSelect,
}: {
  items: DrillItem[];
  onSelect: (key: string) => void;
}) {
  return (
    <View className="gap-2.5">
      {items.map((it) => {
        const body = (
          <Card tone="sticker" className="flex-row items-center gap-3">
            {it.icon ? (
              <View className="h-10 w-10 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
                <Icon name={it.icon} size={22} color={palette.frosting[600]} />
              </View>
            ) : it.leading ? (
              <Text style={{ fontSize: 26 }}>{it.leading}</Text>
            ) : null}
            <View className="flex-1">
              <Text variant="heading">{it.title}</Text>
              {it.subtitle ? <Text variant="muted">{it.subtitle}</Text> : null}
            </View>
            {typeof it.changePct === 'number' ? (
              <Text style={{ color: toneColor[changeTone(it.changePct)] }} className="font-heading">
                {it.changePct >= 0 ? '+' : ''}
                {it.changePct.toFixed(1)}%
              </Text>
            ) : it.tag ? (
              <Text variant="muted">{it.tag}</Text>
            ) : null}
            {it.disabled ? null : (
              <Icon name="chevron-right" size={20} color={palette.frosting[300]} weight="bold" />
            )}
          </Card>
        );
        return it.disabled ? (
          <View key={it.key}>{body}</View>
        ) : (
          <Pressable key={it.key} onPress={() => onSelect(it.key)} className="active:opacity-80">
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}
