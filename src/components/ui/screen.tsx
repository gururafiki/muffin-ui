import { ScrollView, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { cn } from '@/lib/cn';
import { PlaidBackground } from './plaid-background';

type ScreenProps = ViewProps & {
  scroll?: boolean;
  edges?: Edge[];
  contentClassName?: string;
  /** Render the lavender plaid texture behind the content. */
  plaid?: boolean;
  /**
   * Pull-to-refresh for the scroll container. A screen whose list state is
   * empty or errored still renders through here rather than through its list,
   * so without this the gesture would work on a populated screen and silently
   * do nothing on exactly the screens where a retry matters most.
   */
  refreshControl?: ScrollViewProps['refreshControl'];
};

/**
 * Page wrapper: applies the bakery background, safe-area insets and an optional
 * scroll container with a centered max-width column for wide (web) layouts.
 */
export function Screen({
  scroll = true,
  edges = ['top'],
  className,
  contentClassName,
  plaid,
  refreshControl,
  children,
  ...props
}: ScreenProps) {
  const inner = (
    <View
      className={cn('mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-2', contentClassName)}
      {...props}>
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={edges} className={cn('flex-1 bg-dough dark:bg-night-bg', className)}>
      {plaid ? <PlaidBackground opacity={0.5} /> : null}
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}
