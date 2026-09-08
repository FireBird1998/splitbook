/**
 * Browser-side Better Auth client. Talks to `/api/auth/*` on the current
 * origin; the demo persona plugin adds `authClient.demoPersona.signIn`.
 */

import { createAuthClient } from 'better-auth/react';
import { demoPersonaClient } from '@/lib/auth/demo-persona-client';

export const authClient = createAuthClient({
  plugins: [demoPersonaClient()],
});

/**
 * Start the Google redirect flow. Better Auth sends the browser to Google
 * and, after the callback, to `callbackURL`; a rejected identity lands on
 * `/login?error=<code>` instead (see LoginForm).
 */
export function signInWithGoogle(callbackURL: string) {
  return authClient.signIn.social({
    provider: 'google',
    callbackURL,
    errorCallbackURL: '/login',
  });
}

/** Sign out, then reload at the landing page (persona picker or marketing page). */
export async function signOutToHome() {
  await authClient.signOut();
  window.location.assign('/');
}
