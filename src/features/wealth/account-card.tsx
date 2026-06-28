import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Badge, Card, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { accountTypeMeta, accountValue, formatMoney, type Account } from './portfolio';

export function AccountCard({
  account,
  currency,
  onPress,
}: {
  account: Account;
  currency: string;
  onPress?: () => void;
}) {
  const meta = accountTypeMeta(account.type);
  const value = accountValue(account);
  const negative = value < 0;

  return (
    <Pressable onPress={onPress} disabled={!onPress} className="active:opacity-80">
      <Card tone="sticker" className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
          <Icon name={meta.icon} size={24} color={palette.frosting[600]} />
        </View>
        <View className="flex-1">
          <Text variant="heading">{account.name}</Text>
          <View className="mt-0.5 flex-row items-center gap-2">
            <Badge label={meta.name} tone="info" />
            {account.holdings.length ? (
              <Text variant="muted">{account.holdings.length} holdings</Text>
            ) : null}
          </View>
        </View>
        <Text
          variant="heading"
          style={{ color: negative ? palette.bearish : undefined }}>
          {formatMoney(value, currency)}
        </Text>
      </Card>
    </Pressable>
  );
}
