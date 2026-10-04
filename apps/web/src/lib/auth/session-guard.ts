import { reloadForAccountChange } from '@/lib/utils/api-fetch';

/** The parts of Better Auth's `useSession()` state the guard reads. */
export interface SessionSnapshot {
  data: { user?: { id?: string | null } | null } | null;
  isPending: boolean;
  /** A refetch keeps the last answer in `data` until the new one arrives. */
  isRefetching?: boolean;
  error: { status?: number } | Error | null;
}

/**
 * Whether the Better Auth session now answers for someone other than the
 * account the page was rendered for, or for no one. A pending check or a
 * failed request (offline, server error) proves nothing; a 401 means signed out.
 */
export function sessionLeftAccount(accountId: string, session: SessionSnapshot): boolean {
  if (session.isPending) return false;
  if (session.error) return 'status' in session.error && session.error.status === 401;
  return session.data?.user?.id !== accountId;
}

/**
 * Reload when the session has left the page's account. A best-effort extra
 * on top of the API's 419 check: it hears another tab's sign-out broadcast and
 * refetches on focus, but a sign-in elsewhere broadcasts nothing.
 */
export function guardSession(accountId: string, session: SessionSnapshot): void {
  if (sessionLeftAccount(accountId, session)) reloadForAccountChange();
}
