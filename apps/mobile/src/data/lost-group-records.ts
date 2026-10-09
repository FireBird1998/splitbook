import { z } from 'zod';
import type { MobileDependencies } from './types';

const journal = z.object({ accountId: z.string(), groupIds: z.array(z.string()) });
export const financialCleanupMessage =
  'This Group’s financial records could not be removed from this device. They stay locked. Restart to retry cleanup.';

/** Durable access-loss cleanup, separate from the financial databases that can fail (#212). */
export function lostGroupRecords({
  accountLocal,
  expenseDrafts,
  settlementAttempts,
}: Pick<MobileDependencies, 'accountLocal' | 'expenseDrafts' | 'settlementAttempts'>) {
  const storage = accountLocal?.financialCleanup;
  let pending: z.infer<typeof journal> | null = null;
  let unreadable = false;
  const load = async () => {
    if (!storage) return;
    const value = await storage.load();
    pending = value === null ? null : journal.parse(value);
    unreadable = false;
  };
  const save = async () => {
    if (pending?.groupIds.length) await storage?.save(pending);
    else await storage?.clear();
  };
  // All callers run inside the strict account queue, including startup recovery.
  const remove = async (accountId: string, groupId: string) => {
    await expenseDrafts?.remove(accountId, groupId);
    await settlementAttempts?.remove(accountId, groupId);
    const before = pending;
    if (pending?.accountId === accountId)
      pending = { ...pending, groupIds: pending.groupIds.filter((id) => id !== groupId) };
    try {
      await save();
    } catch (error) {
      pending = before;
      throw error;
    }
  };
  const mark = async (accountId: string, groupId: string) => {
    await load();
    const groupIds = new Set(pending?.accountId === accountId ? pending.groupIds : []);
    groupIds.add(groupId);
    pending = { accountId, groupIds: [...groupIds] };
    await save();
  };
  return {
    mark,
    blocked: (accountId: string, groupId: string) =>
      unreadable || !!(pending?.accountId === accountId && pending.groupIds.includes(groupId)),
    async erase(accountId: string, groupId: string) {
      // Record the intent before deletion: a kill or partial delete is retried at startup.
      await mark(accountId, groupId);
      await remove(accountId, groupId);
    },
    async recover() {
      try {
        await load();
      } catch {
        unreadable = true;
        return;
      }
      for (const groupId of [...(pending?.groupIds ?? [])]) {
        try {
          await remove(pending!.accountId, groupId);
        } catch {
          /* The journal stays; financial forms never read these records. */
        }
      }
    },
  };
}
