import { mutate } from 'swr';
import { matchScope } from '@splitbook/shared/query-keys';
import {
  matchWebGroupRead,
  matchWebGroupContent,
  isWebAccountGroupsRead,
} from '@/lib/web-query-keys';
import { forgetBrowserGroupSettlementAttempts } from '@/lib/settlement-attempts';

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

// Browser-only: on the server, module state and the default SWR cache would
// be shared by every request.

/** Counts requests and losses, so an answer can tell whether it was sent before a loss. */
let sequence = 0;
/** Groups this document has lost and not yet read again, with when they were lost. */
const lostGroups = new Map<string, number>();
const denied = { denied: true } as const;

/** Taken by `apiFetch` as it sends each request, and handed back with the response. */
export function groupRequestTicket(): number {
  return ++sequence;
}

/**
 * Delete everything this tab holds for a Group the account has lost.
 *
 * - The denial is written to the Group read first, so the Group page shows
 *   only the refused-Group state ("Group could not be loaded."): with its
 *   other entries emptied, the Expense list alone would read "No expenses yet".
 * - The Group's other entries are deleted, data and error alike, so nothing
 *   from before can reappear if access returns; a request already in flight
 *   for them is discarded by SWR.
 * - The Groups list, the account's balances, and Home's latest changes and spending chart
 *   list the Group too, so they are cleared and refetched rather than only refetched: a page
 *   that mounts them later, or whose refetch fails, never shows the Group from them.
 * - The account's unconfirmed payments in the Group are forgotten (#198):
 *   they can no longer be resent there.
 */
function forgetGroup(groupId: string, accountId: string | null) {
  lostGroups.set(groupId, ++sequence);
  void mutate((key) => matchWebGroupRead(groupId)(key) && matchScope('group')(key), denied, {
    revalidate: false,
  });
  void mutate(matchWebGroupContent(groupId), undefined, {
    revalidate: false,
  });
  void mutate(isWebAccountGroupsRead, undefined);
  if (accountId) void forgetBrowserGroupSettlementAttempts(accountId, groupId);
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
  lostGroups.delete(groupId);
  void mutate(matchWebGroupContent(groupId), undefined);
}

/** Writes that can change the account's Groups, or its balance in one of them. */
const ACCOUNT_GROUPS_WRITE = /^\/api\/(?:groups|invitations|join)(?=[/?]|$)/;

/**
 * Whether a response is a write that went through and may have changed the account's Group
 * list or balances: a Group created, edited or left, an Expense or Settlement recorded, an
 * invitation answered. Reads, refusals and failures change nothing.
 */
export function changesAccountGroups(method: string, path: string, status: number): boolean {
  return (
    method.toUpperCase() !== 'GET' &&
    status >= 200 &&
    status < 300 &&
    ACCOUNT_GROUPS_WRITE.test(path)
  );
}

export interface GroupAccessResponse {
  method: string;
  path: string;
  status: number;
  /** The account the page sends as, if it has pinned one. */
  accountId: string | null;
  /** From `groupRequestTicket`, taken when the request was sent. */
  ticket: number;
}

/** Called by `apiFetch` with every app API response. */
export function noteGroupAccess({ method, path, status, accountId, ticket }: GroupAccessResponse) {
  if (typeof window === 'undefined') return;
  const lost = lostGroupId(method, path, status);
  if (lost) return forgetGroup(lost, accountId);
  // The shell's sidebar keeps the Group list and balances on screen across pages (#303):
  // refetch them after a write rather than waiting for their next poll.
  if (changesAccountGroups(method, path, status)) void mutate(isWebAccountGroupsRead);
  const groupId = GROUP_PATH.exec(path)?.[1];
  const lostAt = groupId ? lostGroups.get(groupId) : undefined;
  if (
    groupId &&
    lostAt !== undefined &&
    // An answer sent before the loss says nothing about access now.
    ticket > lostAt &&
    method.toUpperCase() === 'GET' &&
    path === `/api/groups/${groupId}` &&
    status >= 200 &&
    status < 300
  )
    reopenGroup(groupId);
}
