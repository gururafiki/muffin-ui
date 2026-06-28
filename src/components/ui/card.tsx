import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/cn';

type Tone = 'raised' | 'outline' | 'muted' | 'sticker';

type CardProps = ViewProps & {
  /**
   * "raised" soft shadow card (default), "outline" flat bordered, "muted"
   * cream fill, "sticker" thick doodle outline + hard offset shadow (the
   * tactile cartoon look from the bakery reference).
   */
  tone?: Tone;
};

const tones: Record<Tone, string> = {
  raised:
    'bg-white dark:bg-night-surface border border-frosting-100 dark:border-night-border shadow-sm shadow-frosting-200/50',
  outline: 'bg-transparent border border-frosting-200 dark:border-night-border',
  muted: 'bg-crust dark:bg-night-surface-muted border border-transparent',
  sticker: 'bg-white dark:bg-night-surface border-2 border-ink/10 dark:border-night-border',
};

// Hard offset "sticker" shadow (RN; react-native-web maps to box-shadow).
const stickerShadow = {
  shadowColor: '#2E2140',
  shadowOpacity: 0.13,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

export function Card({ tone = 'raised', className, style, ...props }: CardProps) {
  return (
    <View
      className={cn('rounded-muffin p-4', tones[tone], className)}
      style={tone === 'sticker' ? [stickerShadow, style] : style}
      {...props}
    />
  );
}
