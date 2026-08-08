import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Text } from '@/components/ui';
import { getSupabase } from '@/lib/auth/client';
import { beginIntentionalSignOut, useAuth } from '@/lib/auth/store';

import { backupToCloud, restoreFromCloud } from './backup';

/**
 * Account panel in Settings. Fully optional: without an anon key configured it
 * explains how to enable accounts, and the app keeps working anonymously. When
 * signed out it links to the dedicated `/auth` page; when signed in it shows the
 * user + cloud backup + sign-out. Keys never leave the device — an account only
 * adds identity (per-user memory + thread isolation) and the opt-in cloud features.
 */
export function AccountCard() {
  const router = useRouter();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  const supabase = getSupabase();

  const signOut = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      // Mark it BEFORE the call: supabase-js emits the same SIGNED_OUT event for a
      // deliberate sign-out and for a rejected refresh token, and only this flag
      // stops the user being told their session "expired" when they just left.
      beginIntentionalSignOut();
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
            Runs and memories are tied to this account. Your API keys stay on this device — cloud
            backup only stores your portfolio and non-secret settings.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              title="Back up now"
              variant="secondary"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                setNotice(null);
                try {
                  await backupToCloud();
                  setNotice({ tone: 'ok', text: 'Backed up ✓' });
                } catch (e) {
                  setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button
              title="Restore"
              variant="secondary"
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                setNotice(null);
                try {
                  const at = await restoreFromCloud();
                  setNotice({ tone: 'ok', text: `Restored backup from ${new Date(at).toLocaleString()}` });
                } catch (e) {
                  setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button title="Sign out" variant="ghost" disabled={busy} onPress={signOut} />
          </View>
        </>
      ) : (
        <>
          <Text variant="muted">
            Sign in to run agents and keep your own memory + cloud backup. Browsing shared research
            stays open to everyone.
          </Text>
          <Button title="Sign in / Create account" onPress={() => router.push('/auth')} />
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
