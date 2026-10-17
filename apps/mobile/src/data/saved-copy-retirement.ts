import type { createActivityQueries } from './activity-queries';
import type { createExpenseQueries } from './expense-queries';
import type { createGroupQueries } from './group-queries';
import { homePath, type createHomeQueries } from './home-queries';
import { RequestError, Superseded } from './transport';
import type { AccountStorageLease } from './types';
import type { untrustedCopies } from './untrusted-copies';

/**
 * Owns which Saved copies a change retires and when. The controller still owns writes;
 * query modules still own their rows and late-read protection (ADR 0006).
 */
export function savedCopyRetirement(options: {
  lease(): AccountStorageLease | null;
  current(owner: number): boolean;
  now(): number;
  invalidate(...scopes: string[]): void;
  group: Pick<ReturnType<typeof createGroupQueries>, 'forget' | 'changed'>;
  expense: Pick<ReturnType<typeof createExpenseQueries>, 'forget'>;
  activity: Pick<ReturnType<typeof createActivityQueries>, 'forget'>;
  home: Pick<ReturnType<typeof createHomeQueries>, 'forget'>;
  untrusted: Pick<ReturnType<typeof untrustedCopies>, 'mark'>;
}) {
  const ledgerScopes = (groupId: string) => [`ledger:${groupId}`, `balances:${groupId}`, 'home'];
  const changed = (groupId: string) => options.invalidate(...ledgerScopes(groupId));
  const forgetLedger = async (accountId: string, groupId: string, allHome = false) => {
    await options.group.forget(accountId, groupId, 'ledger');
    await options.expense.forget(accountId, groupId);
    await options.activity.forget(accountId, groupId);
    await options.home.forget(accountId, allHome ? undefined : [homePath]);
  };
  /** Queued before later reads/writes of copies; a failed removal makes them untrusted. */
  const removeLedger = async (groupId: string, owner: number) => {
    const lease = options.lease(),
      time = options.now();
    if (!lease) return;
    try {
      await lease.write(() => forgetLedger(lease.accountId, groupId));
    } catch (error) {
      if (options.current(owner) && !(error instanceof Superseded))
        options.untrusted.mark(lease.accountId, ledgerScopes(groupId), time);
    }
  };
  return {
    changed,
    removeLedger,
    /** A definitive invalid request leaves the ledger unchanged; an uncertain reply does not. */
    async ledger<T>(groupId: string, owner: number, send: () => Promise<T>): Promise<T> {
      let refused = false;
      try {
        return await send();
      } catch (error) {
        refused = error instanceof RequestError && [400, 422].includes(error.status);
        throw error;
      } finally {
        if (options.current(owner)) {
          changed(groupId);
          if (!refused) {
            options.group.changed(groupId);
            await removeLedger(groupId, owner);
          }
        }
      }
    },
    /**
     * A Tag action has already retained its intent. Its older copies must be gone BEFORE
     * sending, even if the process dies before a reply. Failed removal forbids sending.
     * `guards` retain the caller's Group/account/online guards around the queued removal.
     */
    async tag<T>(
      groupId: string,
      owner: number,
      lease: AccountStorageLease,
      guards: { current(): void; online(): void },
      send: () => Promise<T>,
    ): Promise<T> {
      guards.online();
      try {
        await lease.write(async () => {
          await options.group.forget(lease.accountId, groupId, 'group');
          await forgetLedger(lease.accountId, groupId, true);
        });
      } catch {
        guards.current();
        throw new Error(
          'Could not clear older saved copies on this device. This try was not sent. Check or retry the original action after storage recovers.',
        );
      }
      guards.online();
      try {
        return await send();
      } finally {
        if (options.current(owner)) {
          options.invalidate(
            `group:${groupId}`,
            ...ledgerScopes(groupId).slice(0, 2),
            'groups',
            'home',
          );
          options.group.changed(groupId);
          await removeLedger(groupId, owner);
          try {
            await lease.write(async () => {
              await options.group.forget(lease.accountId, groupId, 'group');
              await options.home.forget(lease.accountId);
            });
          } catch (error) {
            if (options.current(owner) && !(error instanceof Superseded))
              options.untrusted.mark(
                lease.accountId,
                [`group:${groupId}`, 'groups'],
                options.now(),
              );
          }
        }
      }
    },
  };
}
