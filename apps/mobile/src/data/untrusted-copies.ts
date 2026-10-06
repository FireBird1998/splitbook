import { z } from 'zod';
import { homePath, listPath } from './home-queries';
import type { MobileDependencies } from './types';

const recorded = z.object({ accountId: z.string(), scopes: z.record(z.string(), z.number()) });

/**
 * Saved copies this device couldn't remove (ADR 0006, #212), by scope, each with when: a copy
 * saved then or before is never shown. They are also recorded outside the stores that failed
 * (`accountLocal.untrustedCopies`), so the next start deletes them before anything reads a saved
 * copy; until it can, they stay untrusted. The member is never signed out for them.
 */
export function untrustedCopies({
  accountLocal,
  readCache,
  savedQueries: rows,
}: Pick<MobileDependencies, 'accountLocal' | 'readCache' | 'savedQueries'>) {
  const record = accountLocal?.untrustedCopies,
    untrusted = new Map<string, number>();
  let recording = Promise.resolve();
  const held = async () => {
    const parsed = recorded.safeParse(await record?.load());
    return parsed.success ? parsed.data : null;
  };
  /** A scope's saved copies: a Group's, its ledger's (Balances too), the Groups list or Home's. */
  const remove = async (accountId: string, scope: string) => {
    const [name, groupId = ''] = scope.split(':');
    if (name === 'groups' || name === 'home')
      await rows?.remove(accountId, name === 'groups' ? listPath : homePath);
    else if (name === 'group') await readCache?.invalidateGroup(accountId, groupId);
    else await readCache?.invalidateLedger(accountId, groupId);
  };
  return Object.assign(untrusted, {
    /** These scopes' saved copies from `time` or before couldn't be removed. */
    mark(accountId: string, scopes: string[], time: number) {
      for (const scope of scopes) untrusted.set(scope, time);
      if (!record) return;
      // Added to what is recorded for this account; another account's record is stale.
      recording = recording
        .then(async () => {
          const before = await held().catch(() => null);
          const known = before?.accountId === accountId ? before.scopes : {};
          for (const scope of scopes) known[scope] = time;
          await record.save({ accountId, scopes: known });
        })
        .catch(() => undefined);
    },
    /**
     * At a start, before anything reads a saved copy: deletes the recorded copies, then the
     * record. While one can't be deleted, the record stays and they are never shown.
     */
    async drop() {
      await recording;
      const copies = await held().catch(() => null);
      if (!copies) return;
      try {
        for (const scope of Object.keys(copies.scopes)) await remove(copies.accountId, scope);
        await record?.clear();
      } catch {
        for (const [scope, time] of Object.entries(copies.scopes)) untrusted.set(scope, time);
      }
    },
  });
}
