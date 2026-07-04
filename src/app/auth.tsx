import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/icons';
import { Button, Card, Field, MuffinLogo, Screen, Text } from '@/components/ui';
import { OAUTH_PROVIDERS, signInWithProvider, useEnabledProviders } from '@/features/account/oauth';
import { getSupabase } from '@/lib/auth/client';
import { useAuth } from '@/lib/auth/store';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';

type Mode = 'signIn' | 'signUp';

/**
 * Dedicated sign-in / sign-up page (`/auth`). Opened from the "Sign in to run"
 * gate and the Settings Account card. Email/password + whichever OAuth
 * providers the deployment has configured (auto-detected from GoTrue). Browsing
 * stays anonymous; this page is only reached when the user chooses to sign in.
 */
export default function AuthScreen() {
  const router = useRouter();
  const { session, ready } = useAuth();
  const supabase = getSupabase();
  const providers = useEnabledProviders();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  // Signed in (incl. after an OAuth redirect) → leave the auth page.
  useEffect(() => {
    if (session) {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/agents');
    }
  }, [session, router]);

  const submit = async () => {
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const creds = { email: email.trim(), password };
      const { error } =
        mode === 'signIn'
          ? await supabase.auth.signInWithPassword(creds)
          : await supabase.auth.signUp(creds);
      if (error) setNotice({ tone: 'error', text: error.message });
      else if (mode === 'signUp' && !session)
        setNotice({ tone: 'ok', text: 'Check your inbox to confirm your e-mail, then sign in.' });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (id: (typeof OAUTH_PROVIDERS)[number]['id']) => {
    setBusy(true);
    setNotice(null);
    try {
      await signInWithProvider(id);
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const canSubmit = ready && !busy && !!email.trim() && !!password;

  return (
    <Screen>
      <Stack.Screen options={{ title: mode === 'signIn' ? 'Sign in' : 'Create account' }} />
      <View className="items-center gap-2 pb-4 pt-6">
        <MuffinLogo size={72} />
        <Text variant="title" className="pt-2">
          {mode === 'signIn' ? 'Welcome back' : 'Create your account'}
        </Text>
        <Text variant="muted" className="px-6 text-center">
          Browsing shared research is open to everyone — sign in to run agents and keep your own
          memory. Your API keys stay on this device.
        </Text>
      </View>

      {!supabase ? (
        <Card tone="outline" className="gap-1">
          <Text variant="heading" className="text-base">
            Accounts are off
          </Text>
          <Text variant="muted">
            Set the Supabase URL and anon key in Settings → Connection to enable sign-in.
          </Text>
        </Card>
      ) : (
        <Card className="gap-3">
          {providers.data && providers.data.length > 0 ? (
            <>
              <View className="gap-2">
                {providers.data.map((p) => (
                  <Button
                    key={p.id}
                    title={p.label}
                    variant="secondary"
                    disabled={busy}
                    leftIcon={<Icon name={p.icon} size={20} color={palette.frosting[600]} />}
                    onPress={() => oauth(p.id)}
                  />
                ))}
              </View>
              <View className="flex-row items-center gap-3 py-1">
                <View className="h-px flex-1 bg-frosting-200 dark:bg-night-border" />
                <Text variant="muted" className="text-xs">
                  or
                </Text>
                <View className="h-px flex-1 bg-frosting-200 dark:bg-night-border" />
              </View>
            </>
          ) : null}

          <Field
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Field
            label="Password"
            autoCapitalize="none"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => canSubmit && submit()}
          />
          <Button
            title={mode === 'signIn' ? 'Sign in' : 'Create account'}
            loading={busy}
            disabled={!canSubmit}
            onPress={submit}
          />

          {notice ? (
            <Text className={cn('text-sm', notice.tone === 'error' ? 'text-bearish' : 'text-bullish')}>
              {notice.text}
            </Text>
          ) : null}

          <View className="flex-row justify-center gap-1 pt-1">
            <Text variant="muted" className="text-sm">
              {mode === 'signIn' ? 'New here?' : 'Already have an account?'}
            </Text>
            <Text
              variant="body"
              className="text-sm font-heading text-frosting-600 dark:text-frosting-300"
              onPress={() => {
                setMode(mode === 'signIn' ? 'signUp' : 'signIn');
                setNotice(null);
              }}>
              {mode === 'signIn' ? 'Create an account' : 'Sign in'}
            </Text>
          </View>
        </Card>
      )}
    </Screen>
  );
}
