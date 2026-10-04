import { mutate } from 'swr';
import { isGroupReadKey } from '@/lib/group-read-key';

/**
 * Losing access to a Group (removed, or the Group deleted) removes what the
 * tab holds for it on the first refused read, whichever read that is. The
 * Android app does the same on its first 403. `apiFetch` reports every
 * response here, before its caller (SWR, through `fetcher`) sees it.
 */

const GROUP_PATH = /^\/api\/groups\/([a-f\d]{24})(?=[/?]|$)/i;

/**
 * The Group a response proves this account can no longer read, or null.
 *
 * Only reads count: on a write, 403 can mean "not an admin". Any GET under
 * the Group answered 403 counts; 404 counts only for the Group itself, since
 * a deleted Expense is not a deleted Group. 401 (signed out) and outages
 * say nothing about one Group.
 */
export function lostGroupId(method: string, path: string, status: number): string | null {
  if (method.toUpperCase() !== 'GET') return null;
  const groupId = GROUP_PATH.exec(path)?.[1];
  if (!groupId) return null;
  if (status === 403) return groupId;
  if (status === 404 && path.split('?')[0] === `/api/groups/${groupId}`) return groupId;
  return null;
}

/** Browser-only: Groups this document has lost and not yet read again. */
const lostGroups = new Set<string>();
const denied = { denied: true } as const;

/** The Group's own entries under it: bare paths, and any Group read below the Group itself. */
function isGroupContentKey(key: unknown, groupPath: string) {
  const path = typeof key === 'string' ? key : isGroupReadKey(key) ? key[2] : null;
  return path !== null && (path.startsWith(`${groupPath}/`) || path.startsWith(`${groupPath}?`));
}

/**
 * Delete everything this tab caches for a Group the account has lost.
 *
 * The denial is written to the Group read first, so the Group page shows only
 * the refused-Group state ("Group could not be loaded."): with its other
 * entries emptied, the Expense list alone would read "No expenses yet". Those
 * entries are deleted, data and error alike, so nothing from before can
 * reappear if access returns, and a request already in flight for them is
 * discarded by SWR. The Group list refetches, so it drops the Group.
 */
function forgetGroup(groupId: string) {
  const groupPath = `/api/groups/${groupId}`;
  lostGroups.add(groupId);
  void mutate((key) => isGroupReadKey(key, groupPath) && key[2] === groupPath, denied, {
    revalidate: false,
  });
  void mutate((key) => isGroupContentKey(key, groupPath), undefined, { revalidate: false });
  void mutate((key) => isGroupReadKey(key) && key[2] === '/api/groups');
}

/**
 * The first successful read of a lost Group itself (Retry once the account is
 * back in it) reopens the Group's content from nothing. The refused read that
 * lost the Group still leaves its own error behind, since SWR records it after
 * `forgetGroup` ran. While a key holds an error SWR stops polling it, and a
 * second hook mounting it skips its first read, so the reopened page would
 * show that error instead of reading. This runs before the Group read reaches
 * SWR, so the page renders on clean keys and its mounted reads start over.
 */
function reopenGroup(groupId: string) {
  const groupPath = `/api/groups/${groupId}`;
  lostGroups.delete(groupId);
  void mutate((key) => isGroupContentKey(key, groupPath), undefined);
}

/**
 * Called by `apiFetch` with every app API response. Never on the server,
 * whose module state (and default SWR cache) every request shares.
 */
export function noteGroupAccess(method: string, path: string, status: number): void {
  if (typeof window === 'undefined') return;
  const lost = lostGroupId(method, path, status);
  if (lost) return forgetGroup(lost);
  const groupId = GROUP_PATH.exec(path)?.[1];
  if (
    groupId &&
    lostGroups.has(groupId) &&
    method.toUpperCase() === 'GET' &&
    path === `/api/groups/${groupId}` &&
    status >= 200 &&
    status < 300
  )
    reopenGroup(groupId);
}
