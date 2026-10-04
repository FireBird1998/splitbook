'use client';

import { useEffect } from 'react';
import { forgetBrowserSettlementAttempts } from '@/lib/settlement-attempts';

/**
 * On the first page load for an account, forget the unconfirmed payments
 * any other account stored in this browser (#198): a persona switch or a
 * sign-in elsewhere without signing out here. Only one account is signed in
 * per browser, so nothing another account stored is ever shown or kept.
 */
export default function SettlementAttemptsOwner({ accountId }: { accountId: string }) {
  useEffect(() => {
    forgetBrowserSettlementAttempts({ except: accountId });
  }, [accountId]);
  return null;
}
