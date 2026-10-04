/**
 * Browser-side Better Auth client. Talks to `/api/auth/*` on the current
 * origin; the demo persona plugin adds `authClient.demoPersona.signIn`.
 */

import { createAuthClient } from 'better-auth/react';
import { demoPersonaClient } from '@/lib/auth/demo-persona-client';
import { leaveExpectedAccount } from '@/lib/utils/api-fetch';
import { forgetBrowserSettlementAttempts } from '@/lib/settlement-attempts';

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

/** Sign out, then reload at the landing page (persona picker or marketing page). */
export async function signOutToHome() {
  // This tab navigates on its own; its session guard must not reload it first.
  leaveExpectedAccount();
  const result = await authClient.signOut();
  // Unconfirmed payments are account-local data: none outlives the session (#198).
  // A sign-out that failed (offline, say) leaves the member signed in, so they stay.
  if (!result?.error) forgetBrowserSettlementAttempts();
  window.location.assign('/');
}
