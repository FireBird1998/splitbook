/**
 * Shared helper for mode-aware client sign-in actions.
 * Provider id is never hardcoded at call sites as 'google'.
 */

import type { AuthMode } from '@/lib/auth-mode';

export function getSignInProvider(authMode: AuthMode): 'google' | 'demo' {
  return authMode === 'demo' ? 'demo' : 'google';
}
