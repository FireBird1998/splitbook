import { z } from 'zod';
import type { AccountGroupRecordStore } from './account-record-storage';
export interface FinancialReadStore extends Pick<
  AccountGroupRecordStore,
  'load' | 'save' | 'clear'
> {
  invalidateGroup(accountId: string, groupId: string): Promise<void>;
  /**
   * Removes the saved copies an Expense or Settlement change in this Group makes obsolete: its
   * Expense pages for every Month, each Expense record and its history, Activity and Balances,
   * and Home's figures. The Group itself and the Groups list stay.
   */
  invalidateLedger(accountId: string, groupId: string): Promise<void>;
  retainGroups(accountId: string, groupIds: string[]): Promise<void>;
}
export interface OfflineIdentityStore {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
  clear(): Promise<void>;
}
const cached = z.object({
  version: z.literal(1),
  accountId: z.string(),
  path: z.string(),
  refreshedAt: z.number().finite().nonnegative(),
  value: z.unknown(),
});
export function cachedRead(value: unknown, accountId: string, path: string, now: number) {
  const result = cached.safeParse(value);
  return result.success &&
    result.data.accountId === accountId &&
    result.data.path === path &&
    result.data.refreshedAt <= now
    ? result.data
    : null;
}
