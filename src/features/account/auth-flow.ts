import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Shared helpers for the email/password auth flow (`/auth` + `/verify`).
 *
 * Kept UI-free so both the auth screen and the e-mail-link verify screen agree
 * on validation, GoTrue error phrasing, and which OTP types we understand.
 */

// GoTrue's default GOTRUE_PASSWORD_MIN_LENGTH. Mirror it client-side so we can
// reject obviously-too-short passwords before the round-trip.
export const MIN_PASSWORD = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Inline email-field error, or null when it looks valid / is empty. */
export function emailError(email: string): string | null {
  const value = email.trim();
  if (!value) return null;
  return EMAIL_RE.test(value) ? null : 'Enter a valid e-mail address.';
}

/** Inline password-field error, or null when it's long enough / empty. */
export function passwordError(password: string): string | null {
  if (!password) return null;
  return password.length < MIN_PASSWORD
    ? `Use at least ${MIN_PASSWORD} characters.`
    : null;
}

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email.trim());

/** The email OTP types GoTrue links can carry to `/verify`. */
export const EMAIL_OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

export function isEmailOtpType(value: unknown): value is EmailOtpType {
  return typeof value === 'string' && (EMAIL_OTP_TYPES as string[]).includes(value);
}

/**
 * Turn a raw GoTrue error message into friendlier, on-brand copy. Falls back to
 * the original message for anything we don't specifically recognise, so nothing
 * is ever swallowed.
 */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'That e-mail or password doesn’t look right.';
  if (m.includes('email not confirmed'))
    return 'Confirm your e-mail first — enter the code we sent or tap the link in the message.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'That e-mail already has an account. Try signing in instead.';
  if (m.includes('token has expired') || m.includes('otp_expired') || m.includes('expired'))
    return 'That code or link has expired. Request a new one and try again.';
  if (m.includes('invalid') && (m.includes('token') || m.includes('otp')))
    return 'That code isn’t right. Double-check it or request a new one.';
  if (m.includes('for security purposes') || m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts — please wait a moment before trying again.';
  if (m.includes('password should be')) return `Use at least ${MIN_PASSWORD} characters.`;
  return message;
}
