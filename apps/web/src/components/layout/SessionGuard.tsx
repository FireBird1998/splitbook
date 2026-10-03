'use client';

import { useEffect } from 'react';
import { authClient } from '@/lib/auth-client';
import { guardSession } from '@/lib/auth/session-guard';

/**
 * Subscribes every signed-in page to the Better Auth session, so another
 * tab's sign-out broadcast and the refetch on focus reach it, and reloads
 * when the session no longer belongs to the page's account. Not the
 * guarantee: a sign-in elsewhere broadcasts nothing, and SWR's own focus
 * refetch races it; the API's 419 check covers both.
 */
export default function SessionGuard({ accountId }: { accountId: string }) {
  const session = authClient.useSession();
  useEffect(() => {
    guardSession(accountId, session);
  }, [accountId, session]);
  return null;
}
