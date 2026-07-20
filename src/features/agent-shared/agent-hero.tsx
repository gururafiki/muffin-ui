/**
 * The animated "fresh run" landing screen shared by every agent screen:
 * a centred identity block (icon, title, tagline) fades in, then the
 * caller's own input surface (a chat composer, or a set of Fields) plus
 * optional example chips. Originally ChatScreen-only; generalised so
 * `AgentRunner` and `CouncilScreen` get the same joyful start instead of a
 * plain, unanimated form.
 */
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Screen, Text } from '@/components/ui';
import { SignInToRunNotice } from '@/features/account/run-gate';
import type { AgentDef } from '@/lib/agent/registry';
import { palette } from '@/theme/colors';

export type HeroExample = { label: string; onPress: () => void };

export function AgentHero({
  agent,
  children,
  examples,
  signInRequired,
}: {
  agent: AgentDef;
  /** The composer (chat) or field list + run button (structured agents). */
  children: React.ReactNode;
  examples?: HeroExample[];
  signInRequired?: boolean;
}) {
  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* NativeWind classes don't reach Animated.View — style inner Views. */}
          <Animated.View entering={FadeInDown.duration(350)}>
            <View className="items-center gap-2 pb-6">
              <View className="h-20 w-20 items-center justify-center rounded-bun border-2 border-frosting-200 bg-frosting-100 dark:border-night-border dark:bg-night-surface-muted">
                <Icon name={agent.icon} size={40} color={palette.frosting[600]} />
              </View>
              <Text variant="title" className="pt-2 text-center">
                {agent.title}
              </Text>
              <Text variant="muted" className="px-6 text-center">
                {agent.tagline}
              </Text>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(350).delay(80)}>
            {signInRequired ? (
              <SignInToRunNotice />
            ) : (
              <View className="gap-3">
                {children}
                {examples?.length ? (
                  <View className="gap-2 pt-1">
                    {examples.map((ex) => (
                      <Pressable
                        key={ex.label}
                        onPress={ex.onPress}
                        accessibilityRole="button"
                        accessibilityLabel={`Use example: ${ex.label}`}
                        className="self-center rounded-pill border border-frosting-200 bg-white/70 px-4 py-2 active:opacity-70 dark:border-night-border dark:bg-night-surface">
                        <Text variant="muted" className="text-center text-xs">
                          {ex.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
