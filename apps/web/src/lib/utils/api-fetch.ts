import { ACCOUNT_CHANGED_STATUS, EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';

/**
 * The one request helper for every `/api/` call a signed-in page makes: SWR
 * reads through `fetcher` and the writes. It sends the account the page was
 * rendered for, and on a 419 `ACCOUNT_CHANGED` it reloads the page and hands
 * nothing on: no data reaches SWR, and a write dialog shows neither success
 * nor an error, so nothing from the newer session is shown or recorded under
 * the page's account. Better Auth's own `/api/auth/*` calls never come here.
 */

/** Browser-only: the server never pins, since its module state is shared by every request. */
let expectedAccountId: string | null = null;
let leavingAccount = false;

/**
 * Remember the account this document was rendered for. The first account
 * pinned in a document wins, so a page rendered later for another account
 * inside it (a client-side navigation) still sends the original id. Returns
 * whether `accountId` is the pinned account.
 */
export function pinExpectedAccount(accountId: string): boolean {
  if (typeof window === 'undefined') return true;
  expectedAccountId ??= accountId;
  return expectedAccountId === accountId;
}

/**
 * This tab is signing out on purpose and navigates on its own; its session
 * ending must not trigger a competing reload.
 */
export function leaveExpectedAccount(): void {
  leavingAccount = true;
}

/** Load the page again for whichever account is signed in now (or `/login`). */
export function reloadForAccountChange(): void {
  if (typeof window === 'undefined' || leavingAccount) return;
  window.location.reload();
}

function isAppApi(input: string) {
  return input.startsWith('/api/') && !input.startsWith('/api/auth/');
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (expectedAccountId && isAppApi(input)) headers.set(EXPECTED_ACCOUNT_HEADER, expectedAccountId);
  const response = await fetch(input, { ...init, headers });
  if (response.status === ACCOUNT_CHANGED_STATUS) {
    reloadForAccountChange();
    return new Promise<never>(() => {});
  }
  return response;
}
