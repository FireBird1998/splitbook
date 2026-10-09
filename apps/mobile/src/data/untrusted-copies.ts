import { z } from 'zod';
import { homePath, listPath } from './home-queries';
import { removeGroupRows } from './group-queries';
import { removeRecordRows } from './expense-queries';
import { removeActivityRows } from './activity-queries';
import { parseStoredExpenseDraft } from './expense-draft';
import { parseSettlementAttempt } from './settlement';
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
  savedQueries: rows,
  expenseDrafts,
  settlementAttempts,
  now = Date.now,
}: Pick<
  MobileDependencies,
  'accountLocal' | 'savedQueries' | 'expenseDrafts' | 'settlementAttempts' | 'now'
>) {
  const record = accountLocal?.untrustedCopies,
    untrusted = new Map<string, number>();
  let recording = Promise.resolve();
  const held = async () => {
    const parsed = recorded.safeParse(await record?.load());
    return parsed.success ? parsed.data : null;
  };
  /**
   * A scope's saved copies: a Group's, its ledger's (Balances too), the Groups list or Home's.
   * A Group's view (#219), its Expense records with their changes (#220) and its Activity (#222)
   * keep every saved row on the persister (#223).
   */
  const remove = async (accountId: string, scope: string) => {
    const [name, groupId = ''] = scope.split(':');
    if (name === 'groups' || name === 'home')
      await rows?.remove(accountId, name === 'groups' ? listPath : homePath);
    else if (name === 'group') {
      await removeGroupRows(rows, accountId, groupId, 'group');
    } else {
      await removeGroupRows(rows, accountId, groupId, 'ledger');
      await removeRecordRows(rows, accountId, groupId);
      await removeActivityRows(rows, accountId, groupId);
    }
  };
  /** These scopes' saved copies from `time` or before cannot be shown. */
  const mark = (accountId: string, scopes: string[], time: number) => {
    for (const scope of scopes) untrusted.set(scope, time);
    if (!record) return;
    // Added to what is recorded for this account; another account's record is stale.
    recording = recording
      .then(async () => {
        const before = await held();
        const known = before?.accountId === accountId ? before.scopes : {};
        for (const scope of scopes) known[scope] = time;
        await record.save({ accountId, scopes: known });
      })
      .catch(() => undefined);
  };
  /**
   * At a start, before anything reads a saved copy: deletes the recorded copies, then the
   * record. While one can't be deleted, the record stays and they are never shown.
   */
  const drop = async (pending?: z.infer<typeof recorded>) => {
    await recording;
    let readable = true;
    const saved = await held().catch(() => {
      readable = false;
      // The cleanup record may name any saved view. While it cannot be read, no older copy
      // can be considered safe; live answers remain available and the session stays signed in.
      for (const scope of ['groups', 'group', 'ledger', 'balances', 'home'])
        untrusted.set(scope, now());
      return null;
    });
    // A stored attempt is itself durable evidence. Removing its copies must not depend on
    // successfully writing a second record (or on that optional record being available).
    const copies = [saved, pending].filter((copy) => copy !== null && copy !== undefined);
    if (!copies.length) return;
    try {
      for (const copy of copies)
        for (const scope of Object.keys(copy.scopes)) await remove(copy.accountId, scope);
      if (readable) await record?.clear();
    } catch {
      for (const copy of copies)
        for (const [scope, time] of Object.entries(copy.scopes)) untrusted.set(scope, time);
    }
  };
  return Object.assign(untrusted, {
    mark,
    drop,
    /** A stored attempt may have reached the server before the app was killed (#282). */
    async recover(accountId: string, time: number) {
      const scopes = new Set<string>();
      const [expenses, payments] = await Promise.all([
        expenseDrafts?.list?.(accountId) ?? [],
        settlementAttempts?.list?.(accountId) ?? [],
      ]);
      const addGroup = (groupId: string) => {
        scopes.add(`ledger:${groupId}`);
        scopes.add(`balances:${groupId}`);
        scopes.add('home');
      };
      for (const { groupId, value } of expenses) {
        try {
          const draft = parseStoredExpenseDraft(value, accountId, groupId);
          if (!draft.attempt && !draft.mutation) continue;
          addGroup(groupId);
        } catch {
          // A malformed draft is kept for its existing recovery UI, never treated as a save.
        }
      }
      for (const { groupId, value } of payments) {
        try {
          parseSettlementAttempt(value, accountId, groupId);
          addGroup(groupId);
        } catch {
          // An unreadable payment stays available to its existing recovery UI.
        }
      }
      if (scopes.size) mark(accountId, [...scopes], time);
      await drop(
        scopes.size
          ? {
              accountId,
              scopes: Object.fromEntries([...scopes].map((scope) => [scope, time])),
            }
          : undefined,
      );
    },
  });
}
