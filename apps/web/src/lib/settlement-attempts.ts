import { z } from 'zod/v4';
import type { CrossCurrencySettlementFields } from '@splitbook/shared/cross-currency-settlement';
import { crossCurrencySettlementShape } from '@splitbook/shared/validators/settlement';
import { createSettlementBatchSchema } from '@splitbook/shared/validators/settlement-batch';
import type { SettlementBatchItem } from '@splitbook/shared/settlement-batch';
import { parseAmountMinor, sumMinorAmounts, toMajorAmount } from '@splitbook/shared/exact-money';

/**
 * Unconfirmed Settlements on the web (#198).
 *
 * A Settlement cannot be edited or deleted, and the server deduplicates a
 * retry only by its `Idempotency-Key`. So before a payment's first send, its
 * key and the exact body every send carries are stored in localStorage under
 * the account, the Group and the pair of members. Until a 2xx confirms it, a
 * 422 refuses its first send, or the member discards it on purpose, it is the
 * only payment that pair can record from this browser, and saving it resends
 * the same key and body. Closing the dialog, reloading, switching tabs or
 * opening a second tab never sends anything by itself. Finding and storing
 * the attempt for a pair happen under a lock shared by the browser's tabs.
 * A page sending as another account than it was rendered for stores nothing.
 *
 * A successful sign-out forgets every stored attempt; an account change
 * forgets the other accounts' attempts on its first page load (see
 * `forgetSettlementAttempts`); a refused read of a Group forgets this
 * account's attempts there (see `forgetGroupSettlementAttempts`, #201).
 *
 * Pure over an injected `Storage` and lock, so it runs in node tests; the
 * browser helpers at the end wire it to `window.localStorage` and Web Locks.
 */

const PREFIX = 'splitbook:settlement-attempt:v1:';
/** The server's `parseIdempotencyKey` rule. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/**
 * Who pays whom, how much, as the settlements route takes it. A Debt paid in another currency
 * also carries its paid side and rate (#727); `amount` and `currency` are always the amount
 * cleared.
 */
export interface SettlementPayment extends Partial<CrossCurrencySettlementFields> {
  paidBy: string;
  paidTo: string;
  amount: number;
  currency: string;
  note: string;
  /**
   * A payment that settles several Debts at once (#734): one row for each, sent together to the
   * batch route. `currency` is then the one currency it is paid in, and `amount` what it pays in all.
   */
  batch?: SettlementBatchItem[];
}

/** A payment as the dialog records it: the parties' names are kept for display. */
export interface NamedSettlementPayment extends SettlementPayment {
  paidByName: string;
  paidToName: string;
}

export interface SettlementAttempt extends NamedSettlementPayment {
  accountId: string;
  groupId: string;
  /** The `Idempotency-Key` every send of this payment carries. */
  key: string;
  /** The exact request body every send of this payment carries. */
  body: string;
}

export type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const storedRecord = z.object({
  version: z.literal(1),
  accountId: z.string().min(1),
  groupId: z.string().min(1),
  key: z.string().regex(IDEMPOTENCY_KEY),
  body: z.string(),
  paidByName: z.string(),
  paidToName: z.string(),
});

const sentBody = z.object({
  paidBy: z.string().min(1),
  paidTo: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1),
  note: z.string(),
  ...crossCurrencySettlementShape,
});

/** A payment in another currency's paid side and rate, in the order the route documents them. */
const PAID_SIDE = Object.keys(
  crossCurrencySettlementShape,
) as (keyof CrossCurrencySettlementFields)[];

/**
 * The request body, field for field as the dialog has always sent it, then a payment in
 * another currency's paid side and rate.
 */
export function settlementBody(payment: SettlementPayment) {
  const { paidBy, paidTo, amount, currency, note, batch } = payment;
  // The batch route's body: the people and paying currency once, then each Debt's row (#734).
  if (batch)
    return JSON.stringify(
      createSettlementBatchSchema.parse({
        paidBy,
        paidTo,
        paidCurrency: currency,
        settlements: batch,
      }),
    );
  const paidSide = Object.fromEntries(
    PAID_SIDE.filter((field) => payment[field] !== undefined).map((field) => [
      field,
      payment[field],
    ]),
  );
  return JSON.stringify({ paidBy, paidTo, amount, currency, note, ...paidSide });
}

/** Where a stored body goes: a payment settling several Debts at once has its own route (#734). */
export function settlementPath(groupId: string, body: string) {
  const sent = parseJson(body) as { settlements?: unknown } | undefined;
  return `/api/groups/${groupId}/settlements${Array.isArray(sent?.settlements) ? '/batch' : ''}`;
}

/** A stored batch's body as a payment: what it pays in all, in the one currency it is paid in. */
function batchPayment(body: unknown): SettlementPayment | null {
  const sent = createSettlementBatchSchema.safeParse(body);
  if (!sent.success || !sent.data.paidBy) return null;
  const { paidBy, paidTo, paidCurrency, settlements } = sent.data;
  const paidMinor = sumMinorAmounts(
    settlements.map((row) => row.amountPaidMinor ?? parseAmountMinor(row.amount, row.currency)),
  );
  return {
    paidBy,
    paidTo,
    amount: toMajorAmount(paidMinor, paidCurrency),
    currency: paidCurrency,
    note: '',
    batch: settlements,
  };
}

const groupPrefix = (accountId: string, groupId: string) => `${PREFIX}${accountId}:${groupId}:`;

/** One entry per pair of members, whichever of them pays. */
function storageKey(accountId: string, groupId: string, a: string, b: string) {
  return `${groupPrefix(accountId, groupId)}${[a, b].sort().join('+')}`;
}

function storageKeys(storage: AttemptStorage, prefix: string) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys.sort();
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A stored entry, or null when it is unreadable or filed under another account, Group or pair. */
function parseEntry(entryKey: string, raw: string | null): SettlementAttempt | null {
  if (raw === null) return null;
  const record = storedRecord.safeParse(parseJson(raw));
  if (!record.success) return null;
  const sent = parseJson(record.data.body);
  const single = sentBody.safeParse(sent);
  const payment = single.success ? single.data : batchPayment(sent);
  if (!payment || payment.paidBy === payment.paidTo) return null;
  const { accountId, groupId, key, paidByName, paidToName } = record.data;
  if (entryKey !== storageKey(accountId, groupId, payment.paidBy, payment.paidTo)) return null;
  return {
    ...payment,
    accountId,
    groupId,
    key,
    body: record.data.body,
    paidByName,
    paidToName,
  };
}

/** Every readable attempt this account stored for this Group. */
export function listSettlementAttempts(
  storage: AttemptStorage,
  accountId: string,
  groupId: string,
): SettlementAttempt[] {
  return storageKeys(storage, groupPrefix(accountId, groupId)).flatMap((key) => {
    const attempt = parseEntry(key, storage.getItem(key));
    return attempt ? [attempt] : [];
  });
}

/** The attempt stored for a pair of members, in either direction. */
export function findSettlementAttempt(
  storage: AttemptStorage,
  accountId: string,
  groupId: string,
  a: string,
  b: string,
): SettlementAttempt | null {
  const key = storageKey(accountId, groupId, a, b);
  return parseEntry(key, storage.getItem(key));
}

const sameAttempt = (left: SettlementAttempt | null, right: SettlementAttempt) =>
  left !== null && left.key === right.key && left.body === right.body;

/** Store before the first send; throws when this browser cannot keep it. */
function storeSettlementAttempt(storage: AttemptStorage, attempt: SettlementAttempt) {
  const { accountId, groupId, key, body, paidByName, paidToName, paidBy, paidTo } = attempt;
  const entryKey = storageKey(accountId, groupId, paidBy, paidTo);
  storage.setItem(
    entryKey,
    JSON.stringify({ version: 1, accountId, groupId, key, body, paidByName, paidToName }),
  );
  if (!sameAttempt(parseEntry(entryKey, storage.getItem(entryKey)), attempt))
    throw new Error('The settlement attempt was not stored.');
  notify();
}

/**
 * Remove an attempt only while the stored one is still this key and body:
 * another tab may have discarded it and stored a new payment in the meantime.
 */
export function removeSettlementAttempt(storage: AttemptStorage, attempt: SettlementAttempt) {
  const entryKey = storageKey(attempt.accountId, attempt.groupId, attempt.paidBy, attempt.paidTo);
  if (!sameAttempt(parseEntry(entryKey, storage.getItem(entryKey)), attempt)) return false;
  storage.removeItem(entryKey);
  notify();
  return true;
}

/** Forget every stored attempt (sign-out), or every one but `except`'s (an account change). */
export function forgetSettlementAttempts(storage: AttemptStorage, options?: { except: string }) {
  const kept = options ? `${PREFIX}${options.except}:` : null;
  const forgotten = storageKeys(storage, PREFIX).filter((key) => !kept || !key.startsWith(kept));
  for (const key of forgotten) storage.removeItem(key);
  if (forgotten.length > 0) notify();
}

export const NETWORK_FAILURE = 'The connection failed before this payment was confirmed.';

/**
 * Runs `task` while holding the lock `name` across every tab of this browser.
 * It guards finding and storing (or removing) the attempt for one pair, so
 * two tabs saving at the same moment cannot each store and send a different
 * key for it.
 */
export type PairLock = <T>(name: string, task: () => T) => Promise<T>;

/** No lock: for storage that only this tab can see. */
export const runUnlocked: PairLock = async (_name, task) => task();

/** The lock name for a pair is its storage entry, so either direction takes the same lock. */
const pairLockName = (accountId: string, groupId: string, a: string, b: string) =>
  storageKey(accountId, groupId, a, b);

/**
 * Forget this account's stored attempts for one Group, once a refused read
 * shows it can no longer read the Group (#201). Each pair's entry is removed
 * under that pair's lock, whatever payment it holds.
 */
export async function forgetGroupSettlementAttempts(
  storage: AttemptStorage,
  accountId: string,
  groupId: string,
  lock: PairLock = runUnlocked,
) {
  let forgotten = false;
  await Promise.all(
    // Each entry's key is its pair's lock name (see `pairLockName`).
    storageKeys(storage, groupPrefix(accountId, groupId)).map((entryKey) =>
      lock(entryKey, () => {
        if (storage.getItem(entryKey) === null) return;
        storage.removeItem(entryKey);
        forgotten = true;
      }),
    ),
  );
  if (forgotten) notify();
}

/** `removeSettlementAttempt` under the pair's lock. */
export function discardSettlementAttempt(
  storage: AttemptStorage,
  attempt: SettlementAttempt,
  lock: PairLock = runUnlocked,
) {
  return lock(
    pairLockName(attempt.accountId, attempt.groupId, attempt.paidBy, attempt.paidTo),
    () => removeSettlementAttempt(storage, attempt),
  );
}

export type SettlementSave =
  /** Confirmed by a 2xx; the attempt is removed. */
  | { status: 'recorded' }
  /** Nothing sent: another payment between the pair is stored and comes first. */
  | { status: 'earlier'; attempt: SettlementAttempt }
  /** Nothing sent: the attempt being resent was confirmed or discarded elsewhere. */
  | { status: 'gone' }
  /** Nothing sent: this browser could not keep the attempt. */
  | { status: 'not-stored' }
  /** Nothing stored or sent: the page was rendered for another account than it sends as. */
  | { status: 'stale' }
  /**
   * The first send was refused with a 422, or any send because the Group was archived (#578): the
   * attempt is removed, the entries are the member's to fix.
   */
  | { status: 'rejected'; message: string }
  /** Possibly recorded: the attempt is kept for an explicit resend or discard. */
  | { status: 'unconfirmed'; message: string; attempt: SettlementAttempt };

async function failure(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    code?: unknown;
  } | null;
  return {
    message:
      typeof body?.error === 'string' && body.error
        ? body.error
        : `The server answered ${response.status}.`,
    code: typeof body?.code === 'string' ? body.code : null,
  };
}

type Ready = { attempt: SettlementAttempt; firstSend: boolean };

/**
 * Save a Settlement: either resend the stored attempt the member was shown,
 * unchanged, or store a new payment and send it for the first time. Only a
 * first send's 422 proves the payment was not recorded; any other failure
 * keeps the attempt.
 */
export async function recordSettlement({
  storage,
  accountId,
  groupId,
  resend,
  payment,
  newKey,
  post,
  lock = runUnlocked,
  pinnedToAccount = () => true,
}: {
  storage: AttemptStorage | null;
  accountId: string;
  groupId: string;
  /** The stored attempt shown to the member, sent again as it is. */
  resend?: SettlementAttempt | null;
  /** A new payment, sent only when no attempt is stored for its pair. */
  payment?: NamedSettlementPayment;
  newKey: () => string;
  post: (key: string, body: string) => Promise<Response>;
  lock?: PairLock;
  /**
   * Whether this page's requests go out as `accountId` (#199 pins the account
   * a document was first rendered for). When they don't, the server refuses
   * the write with a 419 before reading it, so a stored copy would be a
   * payment that was never sent, shown as one that may already be recorded.
   */
  pinnedToAccount?: () => boolean;
}): Promise<SettlementSave> {
  if (!storage) return { status: 'not-stored' };
  if (!pinnedToAccount()) return { status: 'stale' };
  const pair = resend ?? payment;
  if (!pair) throw new Error('recordSettlement needs a payment or an attempt to resend.');

  let ready: Ready | SettlementSave;
  try {
    ready = await lock(
      pairLockName(accountId, groupId, pair.paidBy, pair.paidTo),
      (): Ready | SettlementSave => {
        const current = findSettlementAttempt(
          storage,
          accountId,
          groupId,
          pair.paidBy,
          pair.paidTo,
        );
        if (resend) {
          if (!current) return { status: 'gone' };
          if (!sameAttempt(current, resend)) return { status: 'earlier', attempt: current };
          return { attempt: current, firstSend: false };
        }
        if (current) return { status: 'earlier', attempt: current };
        const attempt = { ...pair, accountId, groupId, key: newKey(), body: settlementBody(pair) };
        try {
          storeSettlementAttempt(storage, attempt);
        } catch {
          return { status: 'not-stored' };
        }
        return { attempt, firstSend: true };
      },
    );
  } catch {
    // The lock was never granted, so nothing was stored or sent.
    return { status: 'not-stored' };
  }
  if ('status' in ready) return ready;
  const { attempt, firstSend } = ready;

  // Removing the copy is housekeeping: if it fails, the copy stays to resend, which the key makes safe.
  const forget = async () => {
    try {
      await discardSettlementAttempt(storage, attempt, lock);
    } catch {
      /* kept */
    }
  };

  let response: Response;
  try {
    response = await post(attempt.key, attempt.body);
  } catch {
    return { status: 'unconfirmed', message: NETWORK_FAILURE, attempt };
  }
  if (response.ok) {
    await forget();
    return { status: 'recorded' };
  }
  const { message, code } = await failure(response);
  // An archived Group refuses only after confirming an earlier send, so this one wasn't recorded.
  if ((firstSend && response.status === 422) || code === 'GROUP_ARCHIVED') {
    await forget();
    return { status: 'rejected', message };
  }
  return { status: 'unconfirmed', message, attempt };
}

// Browser wiring: localStorage, and change notifications for this tab and others.

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Calls `listener` when this tab or another one changes a stored attempt. */
export function subscribeSettlementAttempts(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** This browser's localStorage, or null when the page cannot use it. */
export function browserAttemptStorage(): AttemptStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A string that changes whenever this account's attempts for the Group do,
 * for `useSyncExternalStore`; `parseSettlementAttemptsSnapshot` reads it.
 */
export function settlementAttemptsSnapshot(accountId: string, groupId: string): string {
  const storage = browserAttemptStorage();
  if (!storage) return '[]';
  try {
    return JSON.stringify(listSettlementAttempts(storage, accountId, groupId));
  } catch {
    return '[]';
  }
}

export function parseSettlementAttemptsSnapshot(snapshot: string): SettlementAttempt[] {
  return (parseJson(snapshot) as SettlementAttempt[] | undefined) ?? [];
}

/**
 * Web Locks across this browser's tabs where the browser has them, otherwise
 * no lock. A lock orders the tabs; it narrows, but cannot close, the window
 * in which another tab's localStorage write has not reached this one yet.
 */
export function browserPairLock(): PairLock {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks?.request) return runUnlocked;
  return (name, task) => locks.request(name, () => task());
}

/** A Group this account lost (#201): its stored attempts there go, under each pair's lock. */
export async function forgetBrowserGroupSettlementAttempts(accountId: string, groupId: string) {
  const storage = browserAttemptStorage();
  if (!storage) return;
  try {
    await forgetGroupSettlementAttempts(storage, accountId, groupId, browserPairLock());
  } catch {
    // Storage that cannot be read holds nothing this page stored.
  }
}

/** Sign-out, or an account change when `except` is the account signed in now. */
export function forgetBrowserSettlementAttempts(options?: { except: string }) {
  const storage = browserAttemptStorage();
  if (!storage) return;
  try {
    forgetSettlementAttempts(storage, options);
  } catch {
    // Storage that cannot be read holds nothing this page stored.
  }
}
