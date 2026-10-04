import { describe, expect, it, vi } from 'vitest';
import {
  findSettlementAttempt,
  forgetGroupSettlementAttempts,
  forgetSettlementAttempts,
  listSettlementAttempts,
  recordSettlement,
  removeSettlementAttempt,
  settlementBody,
  subscribeSettlementAttempts,
  type AttemptStorage,
  type SettlementAttempt,
} from './settlement-attempts';

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const GROUP = 'b00000000000000000000001';
const OTHER_GROUP = 'b00000000000000000000002';

/** localStorage as the browser exposes it, shared by every "tab" that holds it. */
class MemoryStorage implements AttemptStorage {
  private items = new Map<string, string>();
  failWrites = false;
  failRemoves = false;
  /** Set while a test's lock is held, to check what runs under it. */
  writes: Array<{ op: 'set' | 'remove'; locked: boolean }> = [];
  locked = false;
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.writes.push({ op: 'set', locked: this.locked });
    this.items.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemoves) throw new DOMException('Storage unavailable', 'SecurityError');
    this.writes.push({ op: 'remove', locked: this.locked });
    this.items.delete(key);
  }
  keys() {
    return [...this.items.keys()];
  }
}

const samPaysPriya = {
  paidBy: SAM,
  paidTo: PRIYA,
  amount: 250.25,
  currency: 'INR',
  note: 'Paid via UPI',
  paidByName: 'Sam Chen',
  paidToName: 'Priya Shah',
};

type Sent = { key: string; body: string };

/**
 * The settlements route as the replay contract describes it: a known key
 * returns the record it created; a new key creates one. `answer` can replace
 * the reply for a given send, after or instead of committing.
 */
function fakeServer(
  answer: (send: number, commit: () => void) => Response | 'lost' | undefined = () => undefined,
) {
  const recorded = new Map<string, string>();
  const sent: Sent[] = [];
  const post = vi.fn(async (key: string, body: string) => {
    sent.push({ key, body });
    const commit = () => {
      if (!recorded.has(key)) recorded.set(key, body);
    };
    const reply = answer(sent.length, commit);
    if (reply === 'lost') throw new TypeError('Failed to fetch');
    if (reply) return reply;
    commit();
    return Response.json({ data: { body: recorded.get(key) } }, { status: 201 });
  });
  return { post, sent, recorded };
}

let keys = 0;
const newKey = () => `key-${String(++keys).padStart(8, '0')}`;

function save(
  storage: AttemptStorage | null,
  post: (key: string, body: string) => Promise<Response>,
  options: { resend?: SettlementAttempt | null; payment?: typeof samPaysPriya } = {},
) {
  return recordSettlement({
    storage,
    accountId: SAM,
    groupId: GROUP,
    newKey,
    post,
    payment: options.resend ? undefined : (options.payment ?? samPaysPriya),
    resend: options.resend ?? null,
  });
}

const stored = (storage: AttemptStorage, account = SAM, group = GROUP) =>
  listSettlementAttempts(storage, account, group);

describe('recordSettlement', () => {
  it('reopening after a lost reply resends the stored key and body, so one payment stays one record', async () => {
    const storage = new MemoryStorage();
    const server = fakeServer((send, commit) => {
      if (send === 1) {
        commit();
        return 'lost';
      }
    });

    const first = await save(storage, server.post);
    expect(first).toMatchObject({ status: 'unconfirmed' });

    // The dialog was closed and opened again: all it has is what storage holds.
    const [attempt] = stored(storage);
    expect(attempt).toMatchObject({ paidBy: SAM, paidTo: PRIYA, amount: 250.25 });
    expect(await save(storage, server.post, { resend: attempt })).toEqual({ status: 'recorded' });

    expect(server.sent).toHaveLength(2);
    expect(server.sent[1]).toEqual(server.sent[0]);
    expect(server.recorded.size).toBe(1);
    expect(stored(storage)).toEqual([]);
  });

  it('stores the key and the exact body before the first send', async () => {
    const storage = new MemoryStorage();
    let atSend: SettlementAttempt[] = [];
    const server = fakeServer(() => {
      atSend = stored(storage);
      return undefined;
    });
    await save(storage, server.post);
    expect(atSend).toHaveLength(1);
    expect(atSend[0].key).toBe(server.sent[0].key);
    expect(atSend[0].body).toBe(server.sent[0].body);
    expect(server.sent[0].body).toBe(settlementBody(samPaysPriya));
  });

  it('a different payment between the same two members, either way round, waits for the stored one', async () => {
    const storage = new MemoryStorage();
    const lose = fakeServer(() => 'lost');
    await save(storage, lose.post);
    const [earlier] = stored(storage);

    const server = fakeServer();
    const larger = await save(storage, server.post, { payment: { ...samPaysPriya, amount: 300 } });
    const reverse = await save(storage, server.post, {
      payment: {
        ...samPaysPriya,
        paidBy: PRIYA,
        paidTo: SAM,
        paidByName: 'Priya Shah',
        paidToName: 'Sam Chen',
      },
    });
    expect(larger).toEqual({ status: 'earlier', attempt: earlier });
    expect(reverse).toEqual({ status: 'earlier', attempt: earlier });
    expect(server.sent).toEqual([]);
    expect(stored(storage)).toEqual([earlier]);
  });

  it('a payment between two other members saves normally beside a stored one', async () => {
    const storage = new MemoryStorage();
    await save(storage, fakeServer(() => 'lost').post);
    const server = fakeServer();
    const result = await save(storage, server.post, {
      payment: {
        ...samPaysPriya,
        paidBy: ALEX,
        paidTo: SAM,
        paidByName: 'Alex Rivera',
        paidToName: 'Sam Chen',
      },
    });
    expect(result).toEqual({ status: 'recorded' });
    expect(server.sent).toHaveLength(1);
    expect(stored(storage)).toEqual([expect.objectContaining({ paidBy: SAM, paidTo: PRIYA })]);
  });

  it('a 422 on the first send removes the attempt and leaves the entries to correct', async () => {
    const storage = new MemoryStorage();
    const server = fakeServer(() =>
      Response.json({ error: 'Validation error', code: 'VALIDATION_ERROR' }, { status: 422 }),
    );
    expect(await save(storage, server.post)).toEqual({
      status: 'rejected',
      message: 'Validation error',
    });
    expect(stored(storage)).toEqual([]);

    // The corrected payment is a new action under a new key.
    const next = fakeServer();
    await save(storage, next.post);
    expect(next.sent[0].key).not.toBe(server.sent[0].key);
  });

  it.each([
    ['a 422 on a retry', 2, () => Response.json({ error: 'Not a member' }, { status: 422 })],
    ['a 403 on a retry', 2, () => Response.json({ error: 'Forbidden' }, { status: 403 })],
    ['a 5xx on the first send', 1, () => Response.json({ error: 'Server down' }, { status: 503 })],
    ['a 5xx on a retry', 2, () => new Response('<html>', { status: 500 })],
  ] as const)('%s keeps the attempt and reports the outcome', async (_, send, reply) => {
    const storage = new MemoryStorage();
    const server = fakeServer((n) => (n < send ? 'lost' : n === send ? reply() : undefined));
    let result = await save(storage, server.post);
    if (send === 2) result = await save(storage, server.post, { resend: stored(storage)[0] });
    expect(result).toMatchObject({ status: 'unconfirmed', attempt: stored(storage)[0] });
    expect((result as { message: string }).message).toBeTruthy();
    expect(stored(storage)).toHaveLength(1);
    expect(new Set(server.sent.map((s) => s.key)).size).toBe(1);
  });

  it('a network failure keeps the attempt', async () => {
    const storage = new MemoryStorage();
    const result = await save(storage, fakeServer(() => 'lost').post);
    expect(result).toMatchObject({
      status: 'unconfirmed',
      message: expect.stringContaining('connection'),
    });
    expect(stored(storage)).toHaveLength(1);
  });

  it('a 2xx removes the attempt only while the stored key and body still match', async () => {
    const storage = new MemoryStorage();
    await save(storage, fakeServer(() => 'lost').post);
    const [first] = stored(storage);
    // Another tab discards it and stores a new payment while this resend is in flight.
    const server = fakeServer(() => {
      removeSettlementAttempt(storage, first);
      void save(storage, fakeServer(() => 'lost').post, {
        payment: { ...samPaysPriya, amount: 100 },
      });
      return undefined;
    });
    expect(await save(storage, server.post, { resend: first })).toEqual({ status: 'recorded' });
    await vi.waitFor(() =>
      expect(stored(storage)).toEqual([expect.objectContaining({ amount: 100 })]),
    );
  });

  it('a resend sends nothing once the stored attempt changed or is gone', async () => {
    const storage = new MemoryStorage();
    await save(storage, fakeServer(() => 'lost').post);
    const [shown] = stored(storage);
    const server = fakeServer();

    removeSettlementAttempt(storage, shown);
    expect(await save(storage, server.post, { resend: shown })).toEqual({ status: 'gone' });

    await save(storage, fakeServer(() => 'lost').post, {
      payment: { ...samPaysPriya, amount: 100 },
    });
    const [replacement] = stored(storage);
    expect(await save(storage, server.post, { resend: shown })).toEqual({
      status: 'earlier',
      attempt: replacement,
    });
    expect(server.sent).toEqual([]);
  });

  it('a storage failure after a 2xx still reports the payment recorded', async () => {
    const storage = new MemoryStorage();
    const server = fakeServer();
    storage.failRemoves = true;
    expect(await save(storage, server.post)).toEqual({ status: 'recorded' });
    // The copy stays, and resending it later is safe: the server replays the same key.
    expect(stored(storage)).toEqual([expect.objectContaining({ key: server.sent[0].key })]);
  });

  it('a page rendered for another account than it sends as stores and sends nothing', async () => {
    const storage = new MemoryStorage();
    await save(storage, fakeServer(() => 'lost').post);
    const [kept] = stored(storage);
    const server = fakeServer();
    const stale = (options: { resend?: SettlementAttempt | null }) =>
      recordSettlement({
        storage,
        accountId: SAM,
        groupId: GROUP,
        newKey,
        post: server.post,
        payment: options.resend ? undefined : { ...samPaysPriya, paidBy: ALEX },
        resend: options.resend ?? null,
        pinnedToAccount: () => false,
      });
    expect(await stale({})).toEqual({ status: 'stale' });
    expect(await stale({ resend: kept })).toEqual({ status: 'stale' });
    expect(server.sent).toEqual([]);
    expect(stored(storage)).toEqual([kept]);
  });

  it('finds, stores and removes under one lock per pair, whichever way round', async () => {
    const storage = new MemoryStorage();
    const names: string[] = [];
    const lock = async <T>(name: string, task: () => T) => {
      names.push(name);
      storage.locked = true;
      try {
        return task();
      } finally {
        storage.locked = false;
      }
    };
    const server = fakeServer((send, commit) => {
      if (send === 1) {
        commit();
        return 'lost';
      }
    });
    const options = { storage, accountId: SAM, groupId: GROUP, newKey, post: server.post, lock };
    await recordSettlement({ ...options, payment: samPaysPriya });
    const reverse = { ...samPaysPriya, paidBy: PRIYA, paidTo: SAM };
    expect(await recordSettlement({ ...options, payment: reverse })).toMatchObject({
      status: 'earlier',
    });
    expect(await recordSettlement({ ...options, resend: stored(storage)[0] })).toEqual({
      status: 'recorded',
    });
    expect(storage.writes).toEqual([
      { op: 'set', locked: true },
      { op: 'remove', locked: true },
    ]);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(1);
  });

  it('sends nothing when the lock is never granted', async () => {
    const storage = new MemoryStorage();
    const server = fakeServer();
    const result = await recordSettlement({
      storage,
      accountId: SAM,
      groupId: GROUP,
      newKey,
      post: server.post,
      payment: samPaysPriya,
      lock: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
    });
    expect(result).toEqual({ status: 'not-stored' });
    expect(server.sent).toEqual([]);
    expect(stored(storage)).toEqual([]);
  });

  it('sends nothing when the attempt cannot be stored first', async () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const server = fakeServer();
    expect(await save(storage, server.post)).toEqual({ status: 'not-stored' });
    expect(await save(null, server.post)).toEqual({ status: 'not-stored' });
    expect(server.sent).toEqual([]);
  });
});

describe('stored attempts', () => {
  it('are kept per account, Group and pair of members', async () => {
    const storage = new MemoryStorage();
    await save(storage, fakeServer(() => 'lost').post);
    expect(stored(storage)).toHaveLength(1);
    expect(stored(storage, ALEX)).toEqual([]);
    expect(stored(storage, SAM, OTHER_GROUP)).toEqual([]);
    expect(findSettlementAttempt(storage, SAM, GROUP, PRIYA, SAM)).toEqual(stored(storage)[0]);
    expect(findSettlementAttempt(storage, SAM, GROUP, ALEX, SAM)).toBeNull();
  });

  it('ignore unreadable entries and records filed under another pair', async () => {
    const storage = new MemoryStorage();
    await save(storage, fakeServer(() => 'lost').post);
    const [key] = storage.keys();
    const record = storage.getItem(key)!;
    storage.removeItem(key);
    storage.setItem(key, '{not json');
    expect(stored(storage)).toEqual([]);
    storage.setItem(key.replace(PRIYA, ALEX), record);
    expect(stored(storage)).toEqual([]);
  });

  it('are all forgotten on sign-out, or all but the signed-in account’s on an account change', async () => {
    const storage = new MemoryStorage();
    storage.setItem('splitbook-theme', 'dark');
    await save(storage, fakeServer(() => 'lost').post);
    await recordSettlement({
      storage,
      accountId: ALEX,
      groupId: OTHER_GROUP,
      newKey,
      post: fakeServer(() => 'lost').post,
      payment: { ...samPaysPriya, paidBy: ALEX, paidByName: 'Alex Rivera' },
    });
    expect(stored(storage, ALEX, OTHER_GROUP)).toHaveLength(1);

    forgetSettlementAttempts(storage, { except: ALEX });
    expect(stored(storage)).toEqual([]);
    expect(stored(storage, ALEX, OTHER_GROUP)).toHaveLength(1);

    forgetSettlementAttempts(storage);
    expect(storage.keys()).toEqual(['splitbook-theme']);
  });

  it('of a Group the account can no longer read are forgotten, each pair under its lock (#201)', async () => {
    const storage = new MemoryStorage();
    storage.setItem('splitbook-theme', 'dark');
    const lost = fakeServer(() => 'lost').post;
    const record = (accountId: string, groupId: string, payment: typeof samPaysPriya) =>
      recordSettlement({ storage, accountId, groupId, newKey, post: lost, payment });
    const samPaysAlex = { ...samPaysPriya, paidTo: ALEX, paidToName: 'Alex Rivera' };
    await record(SAM, GROUP, samPaysPriya);
    await record(SAM, GROUP, samPaysAlex);
    await record(SAM, OTHER_GROUP, samPaysPriya);
    await record(ALEX, GROUP, { ...samPaysAlex, paidBy: PRIYA, paidByName: 'Priya Shah' });
    const forgotten = stored(storage).map((attempt) =>
      storage.keys().find((key) => storage.getItem(key)?.includes(attempt.key)),
    );
    const names: string[] = [];
    const lock = async <T>(name: string, task: () => T) => {
      names.push(name);
      storage.locked = true;
      try {
        return task();
      } finally {
        storage.locked = false;
      }
    };
    const changed = vi.fn();
    const unsubscribe = subscribeSettlementAttempts(changed);
    storage.writes = [];

    await forgetGroupSettlementAttempts(storage, SAM, GROUP, lock);
    unsubscribe();

    expect(stored(storage)).toEqual([]);
    expect(stored(storage, SAM, OTHER_GROUP)).toHaveLength(1);
    expect(stored(storage, ALEX, GROUP)).toHaveLength(1);
    expect(storage.getItem('splitbook-theme')).toBe('dark');
    expect(storage.writes).toEqual([
      { op: 'remove', locked: true },
      { op: 'remove', locked: true },
    ]);
    expect(names.sort()).toEqual(forgotten.sort());
    expect(changed).toHaveBeenCalledTimes(1);

    await forgetGroupSettlementAttempts(storage, SAM, GROUP, lock);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
