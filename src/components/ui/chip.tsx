import { Pressable } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { Text } from './text';

/** Small selectable pill — used for asset-type / filter / sub-sector selectors. */
export function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: IconName;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-1.5 rounded-pill border-2 px-3 py-1.5 active:opacity-80',
        active
          ? 'border-frosting-600 bg-frosting-500'
          : 'border-frosting-200 bg-white dark:border-night-border dark:bg-night-surface',
      )}>
      {icon ? (
        <Icon
          name={icon}
          size={16}
          weight={active ? 'fill' : 'duotone'}
          color={active ? palette.white : palette.frosting[500]}
        />
      ) : null}
      <Text
        className={cn(
          'font-heading text-sm',
          active ? 'text-white' : 'text-frosting-600 dark:text-frosting-300',
        )}>
        {label}
      </Text>
    </Pressable>
  );
}
