import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';

import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'butter' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  className?: string;
};

// Pill-shaped, with a thick outline on filled variants for the bakery look.
const base = 'flex-row items-center justify-center gap-2 rounded-pill active:opacity-80';

const variantBg: Record<Variant, string> = {
  primary: 'bg-frosting-500 border-2 border-frosting-600',
  secondary: 'bg-white dark:bg-night-surface border-2 border-frosting-300 dark:border-night-border',
  butter: 'bg-butter-400 border-2 border-butter-600',
  ghost: 'bg-transparent',
};

const variantText: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-frosting-700 dark:text-frosting-100',
  butter: 'text-ink',
  ghost: 'text-frosting-600 dark:text-frosting-300',
};

const loaderColor: Record<Variant, string> = {
  primary: palette.white,
  secondary: palette.frosting[600],
  butter: palette.ink,
  ghost: palette.frosting[600],
};

const sizePad: Record<Size, string> = {
  sm: 'px-4 py-2',
  md: 'px-5 py-3',
  lg: 'px-6 py-4',
};

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  leftIcon,
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={cn(base, variantBg[variant], sizePad[size], isDisabled && 'opacity-50', className)}
      {...props}>
      {loading ? (
        <ActivityIndicator color={loaderColor[variant]} size="small" />
      ) : (
        <>
          {leftIcon ? <View>{leftIcon}</View> : null}
          <Text className={cn('font-heading text-base', variantText[variant])}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}
