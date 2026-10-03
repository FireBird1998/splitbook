'use client';

import { useEffect, useState } from 'react';
import { pinExpectedAccount, reloadForAccountChange } from '@/lib/utils/api-fetch';

/**
 * Pins the account the signed-in layout was rendered for, so every `/api/`
 * request from this document says which account it expects (see `apiFetch`).
 * The id it mounted with is kept: a page rendered later for another account
 * inside this layout (a client-side navigation) still sends it, and a later
 * render of the layout itself (such as `router.refresh()`) that brings a
 * different account reloads the page.
 */
export default function ExpectedAccountProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: React.ReactNode;
}) {
  // Pin while rendering, before the children's first reads start in their effects.
  useState(() => pinExpectedAccount(accountId));
  useEffect(() => {
    if (!pinExpectedAccount(accountId)) reloadForAccountChange();
  }, [accountId]);
  return children;
}
