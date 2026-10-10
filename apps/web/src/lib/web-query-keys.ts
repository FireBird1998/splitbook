import {
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
