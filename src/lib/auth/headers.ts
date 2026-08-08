import type { Settings } from '@/lib/settings/store';

/**
 * Compose the outbound auth header set from an ALREADY-RESOLVED token.
 *
 * Two layers, both emitted together when configured — passing Cloudflare Access does
 * not authenticate you to the agent, and a user token does not get you past Access:
 *
 * 1. **Identity** (`Authorization: Bearer`) — a Supabase user access token, verified
 *    by the backend's `auth.py`.
 * 2. **Perimeter** (`CF-Access-Client-*`) — the service-token pair a native client
 *    needs because it carries no Access SSO cookie.
 *
 * Split out of `buildAuthHeaders` so the composition can be shared with the
 * per-request hook (`lib/auth/request-hook.ts`) and asserted offline. The import of
 * `Settings` is TYPE-ONLY on purpose: `scripts/auth-check.ts` loads this module under
 * plain `tsx`, where Metro's platform resolution does not exist and anything that
 * reaches `react-native` at runtime fails to load.
 */
export function composeAuthHeaders(
  token: string | undefined,
  settings: Settings,
): Record<string, string> {
  const bearer = token?.trim();
  const cfId = settings.cfAccessClientId.trim();
  const cfSecret = settings.cfAccessClientSecret.trim();
  return {
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    // Both halves or neither — a lone id is not a credential and would just look
    // like a malformed request at the edge.
    ...(cfId && cfSecret
      ? { 'CF-Access-Client-Id': cfId, 'CF-Access-Client-Secret': cfSecret }
      : {}),
  };
}
