import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Button, Card, Field, MuffinLogo, Screen, Text } from '@/components/ui';
import {
  emailError,
  friendlyAuthError,
  isValidEmail,
  passwordError,
} from '@/features/account/auth-flow';
import { OAUTH_PROVIDERS, signInWithProvider, useEnabledProviders } from '@/features/account/oauth';
import { getSupabase } from '@/lib/auth/client';
import { useAuth } from '@/lib/auth/store';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';

type Mode = 'signIn' | 'signUp' | 'verifyOtp' | 'forgotPassword';

type Notice = { tone: 'error' | 'ok'; text: string };

/** Where a confirmation / recovery e-mail should land the user back in-app. */
function emailRedirectTo(): string | undefined {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/verify`;
  }
  return undefined; // native falls back to the deployment SITE_URL
}

/**
 * Dedicated sign-in / sign-up page (`/auth`). Opened from the "Sign in to run"
 * gate and the Settings Account card. A small stepped flow: email/password
 * (with the 6-digit e-mail code confirmation GoTrue sends), password recovery,
 * and whichever OAuth providers the deployment has configured (auto-detected
 * from GoTrue). Browsing stays anonymous; this page is only reached when the
 * user chooses to sign in. The e-mail confirmation *link* is handled by the
 * sibling `/verify` route.
 */
export default function AuthScreen() {
  const router = useRouter();
  const { session, ready } = useAuth();
  const supabase = getSupabase();
  const providers = useEnabledProviders();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Signed in (incl. after OTP verify or an OAuth redirect) → leave the page.
  useEffect(() => {
    if (session) {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/agents');
    }
  }, [session, router]);

  const go = (next: Mode) => {
    setMode(next);
    setNotice(null);
  };

  const fail = (e: unknown) =>
    setNotice({ tone: 'error', text: friendlyAuthError(e instanceof Error ? e.message : String(e)) });

  // ── email + password sign in / sign up ─────────────────────────────────
  const submitCredentials = async () => {
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const creds = { email: email.trim(), password };
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword(creds);
        if (error) fail(error);
      } else {
        const { data, error } = await supabase.auth.signUp({
          ...creds,
          options: { emailRedirectTo: emailRedirectTo() },
        });
        if (error) fail(error);
        else if (data.session) return; // auto-confirm on: session effect redirects
        else {
          setCode('');
          go('verifyOtp'); // confirmation required → collect the e-mailed code
        }
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // ── 6-digit code confirmation ──────────────────────────────────────────
  const verifyCode = async () => {
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'signup',
      });
      if (error) fail(error); // success → SIGNED_IN → session effect redirects
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: emailRedirectTo() },
      });
      if (error) fail(error);
      else setNotice({ tone: 'ok', text: 'Sent a fresh code — check your inbox.' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // ── password recovery ──────────────────────────────────────────────────
  const sendReset = async () => {
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: emailRedirectTo(),
      });
      if (error) fail(error);
      else
        setNotice({
          tone: 'ok',
          text: 'If that e-mail has an account, a reset link is on its way.',
        });
    } catch (e) {
      fail(e);
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
      fail(e);
      setBusy(false);
    }
  };

  const emailIssue = emailError(email);
  const passwordIssue = passwordError(password);
  const credsReady =
    ready && !busy && isValidEmail(email) && !passwordIssue && !!password;

  const title =
    mode === 'signIn'
      ? 'Welcome back'
      : mode === 'signUp'
        ? 'Create your account'
        : mode === 'verifyOtp'
          ? 'Confirm your e-mail'
          : 'Reset your password';

  const subtitle =
    mode === 'verifyOtp'
      ? `Enter the 6-digit code we sent to ${email.trim()} — or tap the link in that e-mail.`
      : mode === 'forgotPassword'
        ? 'Enter your account e-mail and we’ll send you a link to set a new password.'
        : 'Browsing shared research is open to everyone — sign in to run agents and keep your own memory. Your API keys stay on this device.';

  const passwordToggle = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
      hitSlop={8}
      className="p-1"
      onPress={() => setShowPassword((v) => !v)}>
      <Icon name={showPassword ? 'eye-slash' : 'eye'} size={20} color={palette.frosting[400]} />
    </Pressable>
  );

  return (
    <Screen contentClassName="justify-center">
      <Stack.Screen options={{ title }} />
      <View className="items-center gap-2 pb-4 pt-6">
        <MuffinLogo size={72} />
        <Text variant="title" className="pt-2 text-center">
          {title}
        </Text>
        <Text variant="muted" className="px-4 text-center">
          {subtitle}
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
      ) : mode === 'verifyOtp' ? (
        <Card className="gap-3">
          <Field
            label="6-digit code"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
            onSubmitEditing={() => code.length === 6 && verifyCode()}
            className="text-center text-2xl tracking-[8px]"
          />
          <Button
            title="Confirm & sign in"
            loading={busy}
            disabled={busy || code.length < 6}
            onPress={verifyCode}
          />
          {notice ? <NoticeText notice={notice} /> : null}
          <View className="flex-row items-center justify-between pt-1">
            <LinkText label="Resend code" onPress={resendCode} disabled={busy} />
            <LinkText label="Use a different e-mail" onPress={() => go('signUp')} disabled={busy} />
          </View>
        </Card>
      ) : mode === 'forgotPassword' ? (
        <Card className="gap-3">
          <Field
            label="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={emailIssue}
            onSubmitEditing={() => isValidEmail(email) && sendReset()}
          />
          <Button
            title="Send reset link"
            loading={busy}
            disabled={busy || !isValidEmail(email)}
            onPress={sendReset}
          />
          {notice ? <NoticeText notice={notice} /> : null}
          <View className="flex-row justify-center pt-1">
            <LinkText label="Back to sign in" onPress={() => go('signIn')} disabled={busy} />
          </View>
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
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={emailIssue}
          />
          <Field
            label="Password"
            autoCapitalize="none"
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            error={mode === 'signUp' ? passwordIssue : null}
            hint={mode === 'signUp' ? 'At least 6 characters.' : undefined}
            rightSlot={passwordToggle}
            onSubmitEditing={() => credsReady && submitCredentials()}
          />

          {mode === 'signIn' ? (
            <View className="flex-row justify-end">
              <LinkText
                label="Forgot password?"
                onPress={() => go('forgotPassword')}
                disabled={busy}
              />
            </View>
          ) : null}

          <Button
            title={mode === 'signIn' ? 'Sign in' : 'Create account'}
            loading={busy}
            disabled={!credsReady}
            onPress={submitCredentials}
          />

          {notice ? <NoticeText notice={notice} /> : null}

          <View className="flex-row justify-center gap-1 pt-1">
            <Text variant="muted" className="text-sm">
              {mode === 'signIn' ? 'New here?' : 'Already have an account?'}
            </Text>
            <LinkText
              label={mode === 'signIn' ? 'Create an account' : 'Sign in'}
              onPress={() => go(mode === 'signIn' ? 'signUp' : 'signIn')}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

function NoticeText({ notice }: { notice: Notice }) {
  return (
    <Text className={cn('text-sm', notice.tone === 'error' ? 'text-bearish' : 'text-bullish')}>
      {notice.text}
    </Text>
  );
}

function LinkText({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  // A real Pressable (not Text onPress) so the web build renders a focusable,
  // keyboard-activatable control with a button role.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      className={cn('active:opacity-60', disabled && 'opacity-50')}>
      <Text className="font-heading text-sm text-frosting-600 dark:text-frosting-300">{label}</Text>
    </Pressable>
  );
}
