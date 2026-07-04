import { useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Field, Text } from '@/components/ui';
import { getSupabase } from '@/lib/auth/client';
import { useAuth } from '@/lib/auth/store';

/**
 * Sign in / sign up with the deployment's Supabase (Settings → Account).
 * Fully optional: without an anon key configured the card explains how to
 * enable accounts, and the app keeps working anonymously. Keys never leave
 * the device — an account only adds identity (per-user memory + thread
 * isolation) and the opt-in cloud features.
 */
export function AccountCard() {
  const { session, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  const supabase = getSupabase();

  const run = async (action: 'signIn' | 'signUp') => {
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    try {
      const creds = { email: email.trim(), password };
      const { error } =
        action === 'signIn'
          ? await supabase.auth.signInWithPassword(creds)
          : await supabase.auth.signUp(creds);
      if (error) setNotice({ tone: 'error', text: error.message });
      else if (action === 'signUp')
        setNotice({ tone: 'ok', text: 'Account created — you are signed in.' });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
      setNotice(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Text variant="heading" className="flex-1">
          Account
        </Text>
        {session ? <Badge label="signed in" tone="bullish" /> : null}
      </View>

      {!supabase ? (
        <Text variant="muted">
          Accounts are off — set the Supabase URL and anon key in Connection to enable sign-in,
          cloud backup and the shared research library.
        </Text>
      ) : session ? (
        <>
          <Text variant="body">{session.email ?? session.userId}</Text>
          <Text variant="muted" className="text-xs">
            Runs and memories are tied to this account. Your API keys stay on this device.
          </Text>
          <Button title="Sign out" variant="secondary" disabled={busy} onPress={signOut} />
        </>
      ) : (
        <>
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
          />
          <View className="flex-row gap-2">
            <Button
              title="Sign in"
              disabled={busy || !ready || !email.trim() || !password}
              onPress={() => run('signIn')}
            />
            <Button
              title="Create account"
              variant="secondary"
              disabled={busy || !ready || !email.trim() || !password}
              onPress={() => run('signUp')}
            />
          </View>
        </>
      )}
      {notice ? (
        <Text className={notice.tone === 'error' ? 'text-bearish' : 'text-bullish'}>
          {notice.text}
        </Text>
      ) : null}
    </Card>
  );
}
