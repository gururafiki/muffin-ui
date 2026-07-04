import type { EmailOtpType } from '@supabase/supabase-js';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Button, Card, Field, MuffinLogo, Screen, Text } from '@/components/ui';
import { friendlyAuthError, isEmailOtpType, passwordError } from '@/features/account/auth-flow';
import { getSupabase } from '@/lib/auth/client';
import { palette } from '@/theme/colors';

type Phase = 'verifying' | 'recovery' | 'success' | 'error';

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Handles the link GoTrue e-mails for sign-up confirmation, magic links, e-mail
 * changes and password recovery. GoTrue's default `SITE_URL/verify?token=…&type=…`
 * lands here; we exchange the token for a session client-side with `verifyOtp`
 * (see `muffin-agent`/`muffin-deployment` GoTrue config). Recovery links then
 * show a "set a new password" step before continuing into the app.
 */
export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const started = useRef(false);

  const [phase, setPhase] = useState<Phase>('verifying');
  const [message, setMessage] = useState<string>('');

  const rawType = first(params.type);
  const type: EmailOtpType | undefined = isEmailOtpType(rawType) ? rawType : undefined;

  const goToApp = () => router.replace('/(tabs)/agents');

  useEffect(() => {
    if (started.current) return; // a one-time token must be spent exactly once
    started.current = true;

    (async () => {
      const supabase = getSupabase();
      if (!supabase) {
        setPhase('error');
        setMessage('Accounts aren’t configured on this device.');
        return;
      }

      const tokenHash = first(params.token_hash) ?? first(params.token);
      const code = first(params.code);

      try {
        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type ?? 'email',
          });
          if (error) throw error;
        } else if (code) {
          // OAuth / PKCE server-redirect style link (?code=…). detectSessionInUrl
          // may already have exchanged it during client init — only do it if not.
          const { data: pre } = await supabase.auth.getSession();
          if (!pre.session) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
          }
        } else {
          // No token in the URL — maybe detectSessionInUrl already ran.
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            setPhase('error');
            setMessage('This link is missing its token. Request a new e-mail and try again.');
            return;
          }
        }

        if (type === 'recovery') setPhase('recovery');
        else setPhase('success');
      } catch (e) {
        setPhase('error');
        setMessage(friendlyAuthError(e instanceof Error ? e.message : String(e)));
      }
    })();
    // params/type are read once at mount; the guard ref prevents re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Confirmed (non-recovery) → drop the user into the app after a short beat.
  useEffect(() => {
    if (phase !== 'success') return;
    const t = setTimeout(goToApp, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <Screen contentClassName="justify-center">
      <Stack.Screen options={{ title: 'Confirming…' }} />
      <View className="items-center gap-3 pb-2 pt-6">
        <MuffinLogo size={72} />
      </View>

      {phase === 'verifying' ? (
        <Card className="items-center gap-3 py-8">
          <ActivityIndicator color={palette.frosting[500]} />
          <Text variant="heading" className="text-base">
            Confirming your e-mail…
          </Text>
        </Card>
      ) : phase === 'success' ? (
        <Card className="items-center gap-3 py-8">
          <Icon name="check-circle" size={48} color={palette.bullish} weight="fill" />
          <Text variant="title" className="text-center">
            You’re all set!
          </Text>
          <Text variant="muted" className="text-center">
            Your e-mail is confirmed. Taking you into Muffin…
          </Text>
          <Button title="Continue" onPress={goToApp} className="mt-1 w-full" />
        </Card>
      ) : phase === 'recovery' ? (
        <RecoveryForm onDone={goToApp} />
      ) : (
        <Card className="items-center gap-3 py-8">
          <Icon name="warning" size={48} color={palette.bearish} weight="fill" />
          <Text variant="title" className="text-center">
            Couldn’t confirm that
          </Text>
          <Text variant="muted" className="text-center">
            {message}
          </Text>
          <Button title="Back to sign in" onPress={() => router.replace('/auth')} className="mt-1 w-full" />
        </Card>
      )}
    </Screen>
  );
}

/** Set-a-new-password step shown after a recovery link is verified. */
function RecoveryForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = passwordError(password);
  const ready = !busy && !!password && !issue;

  const submit = async () => {
    const supabase = getSupabase();
    if (!supabase || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) setError(friendlyAuthError(err.message));
      else onDone();
    } catch (e) {
      setError(friendlyAuthError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3">
      <Text variant="title" className="text-center">
        Set a new password
      </Text>
      <Field
        label="New password"
        autoCapitalize="none"
        autoComplete="new-password"
        secureTextEntry={!show}
        value={password}
        onChangeText={setPassword}
        error={issue}
        hint="At least 6 characters."
        onSubmitEditing={submit}
        rightSlot={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={show ? 'Hide password' : 'Show password'}
            hitSlop={8}
            className="p-1"
            onPress={() => setShow((v) => !v)}>
            <Icon name={show ? 'eye-slash' : 'eye'} size={20} color={palette.frosting[400]} />
          </Pressable>
        }
      />
      <Button title="Update password & continue" loading={busy} disabled={!ready} onPress={submit} />
      {error ? <Text className="text-sm text-bearish">{error}</Text> : null}
    </Card>
  );
}
