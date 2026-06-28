import { Text as RNText, type TextProps } from 'react-native';

import { cn } from '@/lib/cn';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'muted' | 'label' | 'mono';

// Weight is baked into each font family (custom fonts ignore fontWeight on
// native), so variants pick a family rather than a font-weight utility.
const variants: Record<Variant, string> = {
  display: 'font-display text-4xl text-frosting-700 dark:text-frosting-200',
  title: 'font-title text-2xl text-frosting-700 dark:text-frosting-100',
  heading: 'font-heading text-lg text-ink dark:text-night-text',
  body: 'font-body text-base text-ink dark:text-night-text',
  muted: 'font-body text-sm text-[#7A6A92] dark:text-night-text-muted',
  label: 'font-heading text-xs uppercase tracking-wide text-frosting-500 dark:text-frosting-300',
  mono: 'font-mono text-sm text-ink dark:text-night-text',
};

export type AppTextProps = TextProps & {
  variant?: Variant;
  className?: string;
};

export function Text({ variant = 'body', className, ...props }: AppTextProps) {
  return <RNText className={cn(variants[variant], className)} {...props} />;
}
