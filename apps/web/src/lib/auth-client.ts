/**
 * Browser-side Better Auth client. Talks to `/api/auth/*` on the current
 * origin; the demo persona plugin adds `authClient.demoPersona.signIn`.
 */

import { createAuthClient } from 'better-auth/react';
import { demoPersonaClient } from '@/lib/auth/demo-persona-client';
import { leaveExpectedAccount, stayInExpectedAccount } from '@/lib/utils/api-fetch';
import { forgetBrowserSettlementAttempts } from '@/lib/settlement-attempts';
import { forgetBrowserTagActions } from '@/lib/tag-actions';

export const authClient = createAuthClient({
  plugins: [demoPersonaClient()],
});

export const GOOGLE_SIGN_IN_FAILED = 'google_sign_in_failed';

/**
 * Start the Google redirect flow. Better Auth sends the browser to Google
 * and, after the callback, to `callbackURL`; a rejected identity lands on
 * `/login?error=<code>` instead (see LoginForm).
 */
export async function signInWithGoogle(callbackURL: string) {
  try {
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL,
      errorCallbackURL: '/login',
    });
    if (!result.error) return;
  } catch {
    // Network failures can reject before Better Auth supplies an error result.
  }
  const params = new URLSearchParams({
    error: GOOGLE_SIGN_IN_FAILED,
    callbackUrl: callbackURL,
  });
  window.location.assign(`/login?${params}`);
}

/**
 * Sign out, then reload at the landing page (persona picker or marketing page). Never throws:
 * when the server can't be reached ('unreachable', #536) or refuses to end the session
 * ('refused', #550), the member is still signed in, so this tab stays and the caller tells them.
 */
export async function signOutToHome(): Promise<'leaving' | 'unreachable' | 'refused'> {
  // This tab navigates on its own; its session guard must not reload it first.
  leaveExpectedAccount();
  let result: Awaited<ReturnType<typeof authClient.signOut>>;
  try {
    result = await authClient.signOut();
  } catch {
    // Unreachable: this tab stays signed in, so its session guard and sign-in redirect apply.
    stayInExpectedAccount();
    return 'unreachable';
  }
  // Refused (SESSION_NOT_ENDED, a bad origin, too many tries): the session lives on, so the tab
  // stays, in its expected account too. A 401 means it had already ended, so the tab leaves.
  if (result?.error && result.error.status !== 401) {
    stayInExpectedAccount();
    return 'refused';
  }
  // Unconfirmed payments are account-local data: none outlives the session (#198).
  forgetBrowserSettlementAttempts();
  forgetBrowserTagActions();
  window.location.assign('/');
  return 'leaving';
}
