import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { Text } from './text';

type CollapsibleProps = {
  title: string;
  /** Optional leading icon shown before the title. */
  icon?: IconName;
  iconColor?: string;
  /** Small muted text on the right of the header (e.g. a count or status). */
  meta?: string;
  /** Node rendered in place of `meta` (e.g. a spinner or badge). */
  headerRight?: ReactNode;
  defaultOpen?: boolean;
  /** Indentation depth for nested sections (sub-agents). */
  depth?: number;
  className?: string;
  children: ReactNode;
};

/**
 * Minimal expandable section: a pressable header with a rotating chevron over
 * animated-free show/hide content. Used for the run-timeline steps, nested
 * sub-agent sections, and verbose tool blocks.
 */
export function Collapsible({
  title,
  icon,
  iconColor,
  meta,
  headerRight,
  defaultOpen = false,
  depth = 0,
  className,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View
      className={cn('rounded-crumb', depth > 0 && 'border-l-2 border-frosting-100 pl-2 dark:border-night-border', className)}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center gap-2 py-1.5 active:opacity-70">
        <Icon
          name={open ? 'chevron-down' : 'chevron-right'}
          size={16}
          color={palette.frosting[400]}
          weight="bold"
        />
        {icon ? <Icon name={icon} size={16} color={iconColor ?? palette.frosting[500]} /> : null}
        <Text variant="label" className="flex-1 normal-case">
          {title}
        </Text>
        {headerRight ?? (meta ? <Text variant="muted" className="text-xs">{meta}</Text> : null)}
      </Pressable>
      {open ? <View className="gap-2 pb-2 pl-6">{children}</View> : null}
    </View>
  );
}
