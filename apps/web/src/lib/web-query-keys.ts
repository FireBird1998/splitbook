import { unstable_serialize } from 'swr/infinite';
import {
  activityPageKey,
  matchAccount,
  matchGroup,
  matchScope,
  type QueryAccount,
} from '@splitbook/shared/query-keys';

/** One origin and one page-pinned account per document. #199 reloads an account change. */
export const WEB_QUERY_ACCOUNT: QueryAccount = { environment: 'web', accountId: 'web' };
export const isWebRead = matchAccount(WEB_QUERY_ACCOUNT);
export const matchWebGroupRead = (groupId: string) => (key: unknown) =>
  isWebRead(key) && matchGroup(groupId)(key);

/** All Group reads and the Groups list, as settings changes invalidated before #235. */
export const isWebGroupsRead = (key: unknown) =>
  isWebRead(key) && (key[0] === 'groups' || key.length === 5);

/** Account-wide reads that include a Group: its list and Home's totals/changes/spending. */
export const isWebAccountGroupsRead = (key: unknown) =>
  isWebRead(key) && (matchScope('groups')(key) || matchScope('home')(key));

/** Every read below a Group's own entry, which gets denial-as-data separately. */
export const matchWebGroupContent = (groupId: string) => (key: unknown) =>
  matchWebGroupRead(groupId)(key) && !matchScope('group')(key);

/** Events in each page of a Group's web Activity timeline (#800). */
export const WEB_ACTIVITY_PAGE_SIZE = 50;

/** Page `index` of a Group's Activity timeline, counted from 0 as `useSWRInfinite` does. */
export const webActivityPage = (groupId: string, index: number) =>
  activityPageKey(WEB_QUERY_ACCOUNT, groupId, { page: index + 1, limit: WEB_ACTIVITY_PAGE_SIZE });

/**
 * The key a Group's loaded Activity pages are kept under. SWR's filtered `mutate` skips
 * `useSWRInfinite` keys, so the matchers above never reach them: whatever mutates a Group's
 * reads mutates this key too (#800).
 */
export const webActivityPagesKey = (groupId: string) =>
  unstable_serialize((index: number) => webActivityPage(groupId, index));
