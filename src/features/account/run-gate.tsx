import { useRouter } from 'expo-router';

import { Button, Card, Text } from '@/components/ui';
import { useAuth } from '@/lib/auth/store';
import { useSettings } from '@/lib/settings/store';

/**
 * Whether starting a run is blocked for the current user. The backend
 * (`auth.py`) makes `create` / `create_run` authenticated-only when Supabase
 * auth is enabled, so the app gates the Run action up-front whenever accounts
 * are configured (a Supabase anon key is set) but nobody is signed in. When
 * accounts are off (local dev against an auth-disabled backend), running stays
 * open.
 */
export function useSignInRequiredToRun(): boolean {
  const anonKey = useSettings((s) => s.supabaseAnonKey);
  const session = useAuth((s) => s.session);
  return !!anonKey.trim() && !session;
}

/** Inline "sign in to run" card shown in place of the Run action. */
export function SignInToRunNotice() {
  const router = useRouter();
  return (
    <Card tone="outline" className="gap-2">
      <Text variant="heading" className="text-base">
        Sign in to run agents
      </Text>
      <Text variant="muted">
        Browsing shared runs is open to everyone, but starting a new one needs an account. Your API
        keys stay on this device.
      </Text>
      <Button title="Go to Account" variant="secondary" onPress={() => router.push('/settings')} />
    </Card>
  );
}
