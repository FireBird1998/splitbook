import { afterEach, describe, expect, it, vi } from 'vitest';
import { gatewayReply } from '../test-utils/transport-faults';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';
const actor = 'a00000000000000000000001',
  recipient = 'a00000000000000000000002',
  other = 'a00000000000000000000003';
const groupId = 'b00000000000000000000001',
  settlementId = 'c00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z';
const user = { id: actor, name: 'Alex', email: 'alex@example.test', image: null };
const people = [actor, recipient, other].map((_id, i) => ({
  _id,
  name: ['Alex', 'Sam', 'Priya'][i],
  email: `${i}@example.test`,
  image: null,
}));
const group = {
  _id: groupId,
  createdBy: actor,
  name: 'Shared home',
  category: 'home',
  defaultCurrency: 'INR',
  members: people.map((person) => ({ user: person, role: 'member', joinedAt: iso })),
  createdAt: iso,
  updatedAt: iso,
};
const balances = (amount = 30) => ({
  status: 200,
  data: {
    byCurrency: [
      {
        currency: 'INR',
        balances: [],
        debts: amount ? [{ from: people[0], to: people[1], amount }] : [],
      },
    ],
  },
});
const record = {
  _id: settlementId,
  group: groupId,
  paidBy: people[0],
  paidTo: people[1],
  createdBy: people[0],
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  currency: 'INR',
  note: 'Paid already',
  createdAt: iso,
  updatedAt: iso,
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
function setup(
  intercept: (
    path: string,
    init: RequestInit,
  ) => FetchResponse | Promise<FetchResponse> | undefined = () => undefined,
  withSavedQueries = false,
) {
  let cookie: string | null = null,
    account: string | null = null,
    cleanup = false,
    key = 0;
  const records = new Map<string, unknown>();
  const savedRows = new Map<string, unknown>();
  const store = {
    list: async (account: string) =>
      [...records]
        .filter(([key]) => key.startsWith(account))
        .map(([key, value]) => ({
          groupId: key.slice(account.length),
          value: structuredClone(value),
        })),
    load: async (a: string, g: string) => structuredClone(records.get(a + g) ?? null),
    save: async (a: string, g: string, v: unknown) => {
      records.set(a + g, structuredClone(v));
    },
    remove: async (a: string, g: string) => {
      records.delete(a + g);
    },
    clear: async () => {
      records.clear();
    },
  };
  const writes: RequestInit[] = [];
  /** Every request sent, as `METHOD /path`, in the order sent. */
  const sent: string[] = [];
  /** NetInfo's listeners: the device's connection, which `connect` reports. */
  const connection = new Set<(state: { isConnected: boolean | null }) => void>();
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        credentials: {
          load: async () => cookie,
          save: async (v) => {
            cookie = v;
          },
          clear: async () => {
            cookie = null;
          },
        },
        settlementAttempts: store,
        savedQueries: withSavedQueries ? savedQueriesIn(savedRows) : undefined,
        netInfo: {
          // As NetInfo does, a new listener hears the connection as it is now.
          addEventListener: (listener) => {
            connection.add(listener);
            listener({ isConnected: true });
            return () => connection.delete(listener);
          },
        },
        newSubmissionKey: () => `settlement-key-${++key}`,
        accountLocal: {
          owner: {
            load: async () => account,
            save: async (v) => {
              account = v;
            },
            clear: async () => {
              account = null;
            },
          },
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [store],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname;
          sent.push(`${init.method ?? 'GET'} ${path}`);
          if (path.endsWith('/settlements') && init.method === 'POST') writes.push(init);
          const override = intercept(path, init);
          if (override) return override;
          if (path.endsWith('/sign-in'))
            return new Response(JSON.stringify({ user }), {
              headers: {
                'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000',
              },
            });
          if (path.endsWith('/get-session'))
            return json({ user, session: { userId: actor, expiresAt: '2030-01-01T00:00:00Z' } });
          if (path.endsWith('/sign-out')) return json({ success: true });
          if (path === '/api/groups') return json({ status: 200, data: [group] });
          if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
          if (path.endsWith('/user/balances')) return json({ status: 200, data: { buckets: [] } });
          if (path.endsWith('/balances')) return json(balances());
          if (path.endsWith('/settlements'))
            return init.method === 'POST'
              ? json({ status: 201, data: record }, 201)
              : json({ status: 200, data: [] });
          if (path.endsWith('/expenses'))
            return json({
              status: 200,
              data: {
                expenses: [],
                pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
                summary: {
                  count: 0,
                  totalsByCurrency: [],
                  userOwes: 0,
                  userGetsBack: 0,
                  byMember: [],
                },
              },
            });
          return json({}, 404);
        },
      },
    );
  /** NetInfo reports the device's connection: false when it drops, true when it's back. */
  const connect = (isConnected: boolean) =>
    connection.forEach((listener) => listener({ isConnected }));
  return { controller: create(), create, store, records, writes, sent, connect };
}
describe('native payment recording', () => {
  it('finishes confirmed receipt cleanup without reopening a Group denied while device removal is pending', async () => {
    let holdGroup = false,
      groupArrived!: () => void,
      releaseGroup!: (value: FetchResponse) => void;
    const groupWaiting = new Promise<void>((resolve) => {
      groupArrived = resolve;
    });
    const { controller, store, records, writes } = setup(
      (path) =>
        holdGroup && path === `/api/groups/${groupId}`
          ? new Promise((resolve) => {
              releaseGroup = resolve;
              groupArrived();
            })
          : undefined,
      true,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    let cleanupArrived!: () => void, releaseCleanup!: () => void;
    const cleanupWaiting = new Promise<void>((resolve) => {
      cleanupArrived = resolve;
    });
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const remove = store.remove;
    store.remove = async (account, id) => {
      cleanupArrived();
      await cleanupReleased;
      await remove(account, id);
    };
    holdGroup = true;
    const refreshing = controller.refresh('foreground');
    await groupWaiting;
    const recording = controller.recordSettlement();
    await cleanupWaiting;
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot().settlement.group).not.toBeNull();
    const denied = new Promise<void>((resolve) => {
      const unsubscribe = controller.subscribe(() => {
        if (controller.getSnapshot().settlement.group === null) {
          unsubscribe();
          resolve();
        }
      });
    });
    releaseGroup(json({ status: 403, error: 'Access removed' }, 403));
    await denied;
    const afterDenial: string[] = [];
    const unsubscribe = controller.subscribe(() =>
      afterDenial.push(controller.getSnapshot().screen),
    );
    holdGroup = false;
    releaseCleanup();
    await Promise.all([recording, refreshing]);
    expect(records.size).toBe(0);
    expect(afterDenial).not.toContain('group');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { group: null, draft: null, attempt: null },
    });
    unsubscribe();
    controller.dispose();
  });
  it('keeps a payment unsent and recoverable when Group access is denied while its attempt is stored', async () => {
    let holdGroup = false,
      groupArrived!: () => void,
      releaseGroup!: (value: FetchResponse) => void;
    const groupWaiting = new Promise<void>((resolve) => {
      groupArrived = resolve;
    });
    const { controller, store, records, writes } = setup(
      (path) =>
        holdGroup && path === `/api/groups/${groupId}`
          ? new Promise((resolve) => {
              releaseGroup = resolve;
              groupArrived();
            })
          : undefined,
      true,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    let savingArrived!: () => void, releaseSave!: () => void;
    const saveWaiting = new Promise<void>((resolve) => {
      savingArrived = resolve;
    });
    const saveReleased = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const save = store.save;
    store.save = async (account, id, value) => {
      savingArrived();
      await saveReleased;
      await save(account, id, value);
    };
    holdGroup = true;
    const refreshing = controller.refresh('foreground');
    await groupWaiting;
    const recording = controller.recordSettlement();
    await saveWaiting;
    expect(controller.getSnapshot().settlement.group).not.toBeNull();
    const denied = new Promise<void>((resolve) => {
      const unsubscribe = controller.subscribe(() => {
        if (controller.getSnapshot().settlement.group === null) {
          unsubscribe();
          resolve();
        }
      });
    });
    releaseGroup(json({ status: 403, error: 'Access removed' }, 403));
    await denied;
    holdGroup = false;
    releaseSave();
    await Promise.all([recording, refreshing]);
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: {
        status: 'blocked',
        group: null,
        draft: { amount: '30' },
        attempt: { key: 'settlement-key-1' },
      },
    });
    expect([...records.values()]).toEqual([
      expect.objectContaining({
        version: 1,
        accountId: actor,
        groupId,
        key: 'settlement-key-1',
      }),
    ]);
    expect(JSON.parse(controller.getSnapshot().settlement.attempt?.body ?? 'null')).toEqual({
      paidBy: actor,
      paidTo: recipient,
      amount: 30,
      currency: 'INR',
      note: '',
    });
    controller.dispose();
  });
  it('unlocks a definitely rejected first submission even when a warm invitation interrupts its response', async () => {
    let release!: (value: FetchResponse) => void, entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { controller, records, create } = setup((path, init) =>
      path.endsWith('/settlements') && init.method === 'POST'
        ? new Promise((resolve) => {
            release = resolve;
            entered();
          })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    const saving = controller.recordSettlement();
    await dispatched;
    await controller.openInvitation('http://localhost:4138/join/1234abcd');
    release(json({ status: 422, code: 'VALIDATION_ERROR', error: 'Invalid payment' }, 422));
    await saving;
    expect(controller.getSnapshot().screen).toBe('invite');
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      attempt: null,
      draft: { amount: '30' },
    });
    const restarted = create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    expect(restarted.getSnapshot().settlement.attempt).toBeNull();
  });

  it('keeps an interrupted Record usable, and unsent, after a warm invitation', async () => {
    let hold = false,
      release!: (value: FetchResponse) => void;
    // Record's check before sending, the live Balances read (#333), is held.
    const { controller, writes } = setup((path) =>
      hold && path === `/api/groups/${groupId}/balances`
        ? new Promise((resolve) => {
            release = resolve;
          })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    hold = true;
    const pending = controller.recordSettlement();
    await controller.openInvitation('http://localhost:4138/join/1234abcd');
    release(json(balances()));
    await pending;
    expect(controller.getSnapshot().settlement.status).toBe('editing');
    expect(controller.getSnapshot().screen).toBe('invite');
    expect(writes).toHaveLength(0);
  });
  it.each(['offline', 'storage'] as const)(
    'does not send or queue a payment when %s is unavailable',
    async (failure) => {
      let offline = false;
      const { controller, store, writes, records } = setup((path) =>
        offline && path.startsWith(`/api/groups/${groupId}`)
          ? Promise.reject(new Error('Offline'))
          : undefined,
      );
      await controller.signIn('alex');
      await controller.openSettlements(groupId);
      controller.selectSettlement(actor, recipient, 'INR');
      if (failure === 'offline') offline = true;
      else
        store.save = async () => {
          throw new Error('Disk full');
        };
      await controller.recordSettlement();
      expect(writes).toHaveLength(0);
      expect(records.size).toBe(0);
      expect(controller.getSnapshot().settlement.draft?.amount).toBe('30');
      offline = false;
      await controller.refresh();
      expect(writes).toHaveLength(0);
    },
  );
  it('does not expose recording actions to a third party or accept excess precision', async () => {
    const { controller, writes } = setup((path) =>
      path.endsWith('/balances') && !path.endsWith('/user/balances')
        ? json({
            status: 200,
            data: {
              byCurrency: [
                {
                  currency: 'INR',
                  balances: [],
                  debts: [
                    { from: people[2], to: people[1], amount: 30 },
                    { from: people[0], to: people[1], amount: 30 },
                  ],
                },
              ],
            },
          })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(other, recipient, 'INR');
    expect(controller.getSnapshot().settlement.draft).toBeNull();
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10.001' });
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot().settlement.status).toBe('editing');
  });
  it('purges unresolved payments on sign-out and ignores a late committed response', async () => {
    let release!: (value: FetchResponse) => void, entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { controller, records } = setup((path, init) =>
      path.endsWith('/settlements') && init.method === 'POST'
        ? new Promise((resolve) => {
            release = resolve;
            entered();
          })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    const saving = controller.recordSettlement();
    await dispatched;
    expect(records.size).toBe(1);
    await controller.signOut();
    release(json({ status: 201, data: record }, 201));
    await saving;
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().settlement).toMatchObject({ draft: null, attempt: null });
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
  });

  it('unlocks a definitively rejected new submission for correction without losing input', async () => {
    // A refusal its entries can correct. One the Group's change made (a member left, the currency
    // changed) ends the payment instead (#333).
    const { controller, records } = setup((path, init) =>
      path.endsWith('/settlements') && init.method === 'POST'
        ? json({ status: 422, code: 'VALIDATION_ERROR', error: 'Invalid payment' }, 422)
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      attempt: null,
      draft: { amount: '10', note: 'Paid already' },
    });
    expect(controller.getSnapshot().settlement.message).toContain('currency');
    expect(records.size).toBe(0);
  });

  it('blocks a newly denied member without sending and preserves an unresolved attempt after replay denial', async () => {
    let denied = false,
      rejectReplay = false;
    // As SplitBook does, a member it no longer lets in is refused every request under the Group.
    const { controller, writes, records } = setup((path, init) => {
      if (path.startsWith(`/api/groups/${groupId}`) && denied)
        return json({ status: 403, error: 'Access removed' }, 403);
      if (path.endsWith('/settlements') && init.method === 'POST')
        return rejectReplay
          ? json({ status: 422, code: 'INVALID_MEMBERS', error: 'Membership changed' }, 422)
          : Promise.reject(new Error('Lost response'));
    });
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    denied = true;
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot().settlement.status).toBe('blocked');
    denied = false;
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    await controller.recordSettlement();
    const attempt = controller.getSnapshot().settlement.attempt;
    expect(attempt).not.toBeNull();
    rejectReplay = true;
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('blocked');
    expect(controller.getSnapshot().settlement.attempt).toEqual(attempt);
    expect(records.size).toBe(1);
  });

  it('restores an immutable unresolved payment from Balances and retries the identical key/body only on explicit action', async () => {
    let committed = false,
      lose = true;
    const { controller, create, writes, records } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST') {
        committed = true;
        if (lose) {
          lose = false;
          return Promise.reject(new Error('Response lost after commit'));
        }
        return json({ status: 201, data: record }, 201);
      }
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json(balances(committed ? 20 : 30));
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    expect(records.size).toBe(1);
    const restarted = create();
    await restarted.restore();
    await restarted.openGroup(groupId, true, 'balances');
    expect(restarted.getSnapshot().pendingPayment).toEqual({
      groupId,
      draft: {
        paidBy: actor,
        paidTo: recipient,
        currency: 'INR',
        amount: '10',
        note: 'Paid already',
      },
    });
    await restarted.openPendingPayment();
    await restarted.refresh();
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { status: 'uncertain', draft: { amount: '10' } },
    });
    expect(writes).toHaveLength(1);
    restarted.updateSettlement({ amount: '99' });
    expect(restarted.getSnapshot().settlement.draft?.amount).toBe('10');
    await restarted.recordSettlement();
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toBe(writes[0].body);
    expect(new Headers(writes[1].headers).get('Idempotency-Key')).toBe(
      new Headers(writes[0].headers).get('Idempotency-Key'),
    );
    expect(records.size).toBe(0);
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      snackbar: { message: 'Payment recorded' },
      settlement: { draft: null, attempt: null },
      pendingPayment: null,
    });
  });

  it('keeps an unconfirmed final payment reachable from Balances after the last debt clears', async () => {
    // PR #144 review: the payment commits, its response is lost, then Back and a refresh show
    // "Settled up" with no suggestion left to reach the stored record through.
    let committed = false,
      lose = true;
    const { controller, writes, records } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST') {
        committed = true;
        if (lose) {
          lose = false;
          return Promise.reject(new Error('Response lost after commit'));
        }
        return json(
          { status: 201, data: { ...record, amount: 30, amountMinor: 3000, note: '' } },
          201,
        );
      }
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json(balances(committed ? 0 : 30));
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    // Its outcome is unknown, so Close reads Balances again; the member's refresh does too.
    await controller.back();
    expect(controller.getSnapshot().financial.balances.data?.[0].debts).toEqual([]);
    await controller.refreshBalances();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      financial: { balances: { status: 'ready', data: [{ debts: [] }] } },
      pendingPayment: { groupId, draft: { paidBy: actor, paidTo: recipient, amount: '30' } },
    });
    await controller.openPendingPayment();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: { amount: '30' },
    });
    await controller.recordSettlement();
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toBe(writes[0].body);
    expect(new Headers(writes[1].headers).get('Idempotency-Key')).toBe(
      new Headers(writes[0].headers).get('Idempotency-Key'),
    );
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
      pendingPayment: null,
    });
  });

  it('opens an unconfirmed payment first, saying why, when another suggestion is chosen', async () => {
    let lose = true;
    const { controller, writes } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST' && lose) {
        lose = false;
        return Promise.reject(new Error('Response lost'));
      }
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json({
          status: 200,
          data: {
            byCurrency: [
              {
                currency: 'INR',
                balances: [],
                debts: [
                  { from: people[0], to: people[1], amount: 30 },
                  { from: people[0], to: people[2], amount: 15 },
                ],
              },
            ],
          },
        });
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    await controller.recordSettlement();
    await controller.back();
    await controller.openRecordPayment(actor, other, 'INR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: { paidTo: recipient, amount: '30' },
      message: expect.stringMatching(
        /^This earlier payment isn’t confirmed yet, so it comes first\./,
      ),
    });
    expect(writes).toHaveLength(1);
  });

  it('refuses a suggestion that’s gone by Record, and Close shows the latest balances', async () => {
    // Recording it anyway would be a payment nobody suggested.
    let amount = 30,
      reads = 0;
    const { controller, writes } = setup((path) => {
      if (path === `/api/groups/${groupId}/balances`) {
        reads += 1;
        return json(balances(amount));
      }
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '40' });
    controller.acknowledgeSettlement(true);
    amount = 0;
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      draft: null,
      suggested: null,
      message: 'This suggested payment has changed. Close this to see the latest balances.',
    });
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
    const before = reads;
    await controller.back();
    expect(reads).toBe(before + 1);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      financial: { balances: { status: 'ready', data: [{ debts: [] }] } },
    });
  });

  it('reads Balances again on Close only when the sheet saw newer ones', async () => {
    let amount = 30,
      reads = 0;
    const { controller } = setup((path) => {
      if (path === `/api/groups/${groupId}/balances`) {
        reads += 1;
        return json(balances(amount));
      }
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    let before = reads;
    await controller.back();
    expect(reads).toBe(before);
    amount = 25;
    await controller.openRecordPayment(actor, recipient, 'INR');
    before = reads;
    await controller.back();
    expect(reads).toBe(before + 1);
    expect(controller.getSnapshot().financial.balances.data?.[0].debts[0].amount).toBe(25);
  });

  it('explains an earlier unconfirmed payment even when the sheet can’t check the latest balances', async () => {
    let lose = true,
      down = false;
    const { controller, writes } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST' && lose) {
        lose = false;
        return Promise.reject(new Error('Response lost'));
      }
      if (down && path === `/api/groups/${groupId}`)
        return json({ status: 500, error: 'Server unavailable' }, 500);
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json({
          status: 200,
          data: {
            byCurrency: [
              {
                currency: 'INR',
                balances: [],
                debts: [
                  { from: people[0], to: people[1], amount: 30 },
                  { from: people[0], to: people[2], amount: 15 },
                ],
              },
            ],
          },
        });
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    await controller.recordSettlement();
    await controller.back();
    down = true;
    await controller.openRecordPayment(actor, other, 'INR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: { paidTo: recipient },
      message: expect.stringMatching(
        /^This earlier payment isn’t confirmed yet, so it comes first\. ./,
      ),
    });
    expect(writes).toHaveLength(1);
  });

  it('offers an unconfirmed payment on Balances even when the Expense read fails', async () => {
    let lose = true,
      failExpenses = false;
    const { controller, create } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST' && lose) {
        lose = false;
        return Promise.reject(new Error('Response lost'));
      }
      if (failExpenses && path.endsWith('/expenses'))
        return json({ status: 500, error: 'Server unavailable' }, 500);
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    await controller.recordSettlement();
    failExpenses = true;
    const restarted = create();
    await restarted.restore();
    await restarted.openGroup(groupId, true, 'balances');
    expect(restarted.getSnapshot()).toMatchObject({
      financial: { expenses: { status: 'error' } },
      pendingPayment: { groupId, draft: { paidTo: recipient, amount: '30' } },
    });
  });

  it('clears the unconfirmed row once its retry is confirmed, even after leaving the Group', async () => {
    let lose = true,
      hold = false,
      release!: (value: FetchResponse) => void,
      entered!: () => void;
    const posted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { controller, records } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST') {
        if (lose) {
          lose = false;
          return Promise.reject(new Error('Response lost'));
        }
        if (hold)
          return new Promise((resolve) => {
            release = resolve;
            entered();
          });
      }
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    await controller.recordSettlement();
    await controller.back();
    expect(controller.getSnapshot().pendingPayment).not.toBeNull();
    await controller.openPendingPayment();
    hold = true;
    const retry = controller.recordSettlement();
    await posted;
    await controller.openInvitation('http://localhost:4138/join/1234abcd');
    release(
      json({ status: 201, data: { ...record, amount: 30, amountMinor: 3000, note: '' } }, 201),
    );
    await retry;
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({ screen: 'invite', pendingPayment: null });
  });

  it('keeps Balances following the Group’s reads while the sheet is open', async () => {
    // A pull's Expense read that finishes under the sheet still reads Balances again.
    let hold = false,
      amount = 30,
      release!: () => void,
      entered!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller } = setup((path) => {
      if (hold && path.endsWith('/expenses')) {
        hold = false;
        entered();
        return gate.then(() =>
          json({
            status: 200,
            data: {
              expenses: [],
              pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
              summary: {
                count: 0,
                totalsByCurrency: [],
                userOwes: 0,
                userGetsBack: 0,
                byMember: [],
              },
            },
          }),
        );
      }
      if (path === `/api/groups/${groupId}/balances`) return json(balances(amount));
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    hold = true;
    const refreshing = controller.refreshExpenses();
    await held;
    await controller.openRecordPayment(actor, recipient, 'INR');
    amount = 25;
    release();
    await refreshing;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      financial: { balances: { status: 'ready', data: [{ debts: [{ amount: 25 }] }] } },
    });
    await controller.back();
    expect(controller.getSnapshot().financial.balances.status).toBe('ready');
  });

  it('requires explicit acknowledgment above the latest suggestion and resets it when that suggestion changes', async () => {
    let suggested = 30;
    const { controller, writes } = setup((path, init) => {
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json(balances(suggested));
      if (path.endsWith('/settlements') && init.method === 'POST')
        return json(
          { status: 201, data: { ...record, amount: 35, amountMinor: 3500, note: '' } },
          201,
        );
    });
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '35' });
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
    controller.acknowledgeSettlement();
    suggested = 15;
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      suggested: 15,
      acknowledged: false,
      draft: { amount: '35' },
    });
    controller.acknowledgeSettlement();
    await controller.recordSettlement();
    expect(writes).toHaveLength(1);
  });

  it.each([503, 403])(
    'keeps a confirmed payment confirmed when the Balances read after it fails (%s)',
    async (status) => {
      let committed = false;
      const { controller, records, writes } = setup((path, init) => {
        if (path.endsWith('/settlements') && init.method === 'POST') {
          committed = true;
          return json({ status: 201, data: record }, 201);
        }
        if (committed && path === `/api/groups/${groupId}/balances`)
          return json({ status, error: 'Payment refresh unavailable' }, status);
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId, true, 'balances');
      await controller.openRecordPayment(actor, recipient, 'INR');
      controller.updateSettlement({ amount: '10', note: 'Paid already' });
      await controller.recordSettlement();
      expect(writes).toHaveLength(1);
      expect(records.size).toBe(0);
      const snapshot = controller.getSnapshot();
      expect(snapshot.screen).toBe('group');
      expect(snapshot.settlement).toMatchObject({ draft: null, attempt: null });
      if (status === 503)
        expect(snapshot).toMatchObject({
          destination: 'balances',
          // Said truthfully: the payment is recorded, its Balances aren't updated yet (#219).
          snackbar: {
            message: 'Payment recorded. Balances couldn’t be updated yet — pull to refresh.',
          },
          financial: { balances: { status: 'error' } },
        });
      else expect(snapshot.detail.status).toBe('denied');
      await controller.recordSettlement();
      expect(writes).toHaveLength(1);
    },
  );

  it('keeps a payment unconfirmed after one send to a failing gateway, says SplitBook can’t be reached, and sends it again only on Retry (#231)', async () => {
    // The gateway fails from the moment the payment is sent until it recovers.
    let gateway: 'up' | 'down' | 'recovered' = 'up';
    const { controller, writes, records } = setup((path, init) => {
      if (gateway === 'up' && path.endsWith('/settlements') && init.method === 'POST')
        gateway = 'down';
      if (gateway === 'down') return gatewayReply(502);
    });
    const key = (init: RequestInit) => new Headers(init.headers).get('Idempotency-Key');
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.recordSettlement();
    expect(writes).toHaveLength(1);
    const attempt = { key: 'settlement-key-1', body: writes[0].body };
    expect(key(writes[0])).toBe(attempt.key);
    expect(controller.getSnapshot().settlement).toMatchObject({ status: 'uncertain', attempt });
    expect([...records.values()]).toEqual([expect.objectContaining(attempt)]);

    // Opened again while the gateway still fails, it says SplitBook can't be reached, and that
    // the payment may already be recorded (#334).
    await controller.openSettlements(groupId);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt,
      message:
        'Could not reach SplitBook. Check your connection and try again. This payment may already be recorded. Retry sends the same record, so it can’t be counted twice.',
    });
    expect(writes).toHaveLength(1);

    // Recovered: nothing is sent by itself, and Retry sends the same key and body.
    gateway = 'recovered';
    await controller.openSettlements(groupId);
    expect(controller.getSnapshot().settlement).toMatchObject({ status: 'uncertain', attempt });
    expect(writes).toHaveLength(1);
    await controller.recordSettlement();
    expect(writes).toHaveLength(2);
    expect({ key: key(writes[1]), body: writes[1].body }).toEqual(attempt);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
      settlement: { attempt: null },
    });
  });

  // #219 (loading-state audit): until Balances are read after a payment, they offer none, so the
  // sheet can't reopen on the debt the payment just settled. Once they are, a sheet reopened while
  // the rest of the refresh after it runs (Home's figures) is kept as it is.
  it('offers no payment while Balances are read again after an earlier one, then opens on the new figures and keeps that sheet', async () => {
    let committed = false,
      held = false,
      homeHeld = false;
    let release!: (value: FetchResponse) => void, entered!: () => void;
    let releaseHome!: (value: FetchResponse) => void, homeEntered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const homeDispatched = new Promise<void>((resolve) => {
      homeEntered = resolve;
    });
    const { controller } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST') {
        committed = true;
        return json({ status: 201, data: record }, 201);
      }
      if (committed && path === `/api/groups/${groupId}/balances`) {
        if (!held) {
          held = true;
          return new Promise((resolve) => {
            release = resolve;
            entered();
          });
        }
        return json(balances(20));
      }
      if (committed && path === '/api/user/balances' && !homeHeld) {
        homeHeld = true;
        return new Promise((resolve) => {
          releaseHome = resolve;
          homeEntered();
        });
      }
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    const saving = controller.recordSettlement();
    await dispatched;
    // The sheet closed onto Balances, which are still being read: the payment says it is recorded,
    // and choosing Record does nothing.
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
      financial: { balances: { changed: true } },
    });
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().screen).toBe('group');
    release(json(balances(20)));
    // Balances are read; Home's figures, read last, are slow.
    await homeDispatched;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
      financial: { balances: { data: [{ debts: [{ amount: 20 }] }] } },
    });
    expect(controller.getSnapshot().financial.balances.changed).toBeFalsy();
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '5' });
    const reopened = controller.getSnapshot().settlement;
    expect(reopened).toMatchObject({
      status: 'editing',
      suggested: 20,
      draft: { amount: '5' },
    });
    releaseHome(json({ status: 200, data: { buckets: [] } }));
    await saving;
    expect(controller.getSnapshot().screen).toBe('settlement');
    expect(controller.getSnapshot().settlement).toEqual(reopened);
  });

  it('persists the exact actual payment before recording, then closes onto refreshed Balances', async () => {
    let committed = false;
    const { controller, records, writes } = setup((path, init) => {
      if (path.endsWith('/settlements') && init.method === 'POST') {
        expect([...records.values()]).toMatchObject([
          {
            body: JSON.stringify({
              paidBy: actor,
              paidTo: recipient,
              amount: 10,
              currency: 'INR',
              note: 'Paid already',
            }),
          },
        ]);
        committed = true;
        return json({ status: 201, data: record }, 201);
      }
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json(balances(committed ? 20 : 30));
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.recordSettlement();
    expect(writes).toHaveLength(1);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      snackbar: { groupId, message: 'Payment recorded' },
      settlement: { draft: null, attempt: null },
      financial: { balances: { status: 'ready', data: [{ debts: [{ amount: 20 }] }] } },
    });
  });

  it('refreshes a changed suggestion on Record, keeping a partial actual payment and sending nothing', async () => {
    let suggested = 30;
    const { controller, writes } = setup((path) =>
      path.endsWith('/balances') && !path.endsWith('/user/balances')
        ? json(balances(suggested))
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement.draft?.amount).toBe('30');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    suggested = 25;
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      suggested: 25,
      draft: { amount: '10', paidBy: actor, paidTo: recipient, currency: 'INR' },
    });
    expect(writes).toHaveLength(0);
  });

  it('opens Record over Balances pre-filled from a live read, leaving the Group’s own reads running', async () => {
    let hold = false,
      release!: (value: FetchResponse) => void,
      entered!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { controller, writes } = setup((path) => {
      if (hold && path === `/api/groups/${groupId}/balances`) {
        hold = false;
        return new Promise((resolve) => {
          release = resolve;
          entered();
        });
      }
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    hold = true;
    const refreshing = controller.refreshBalances();
    await held;
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: {
        status: 'editing',
        suggested: 30,
        acknowledged: false,
        draft: { paidBy: actor, paidTo: recipient, currency: 'INR', amount: '30', note: '' },
      },
    });
    release(json(balances(30)));
    await refreshing;
    expect(controller.getSnapshot().financial.balances.status).toBe('ready');
    // Close and Android Back return to Balances, recording nothing.
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      settlement: { draft: null },
    });
    expect(writes).toHaveLength(0);
  });

  it('says so when the chosen suggestion is gone by the sheet’s live read', async () => {
    let amount = 30;
    const { controller, writes } = setup((path) =>
      path.endsWith('/balances') && !path.endsWith('/user/balances')
        ? json(balances(amount))
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    amount = 0;
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      draft: null,
      message: 'This suggested payment has changed. Close this to see the latest balances.',
    });
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
  });

  it('keeps the overpayment tick through note edits and asks again after a new amount', async () => {
    const { controller } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '35' });
    controller.acknowledgeSettlement(true);
    controller.updateSettlement({ note: 'Rounded up' });
    expect(controller.getSnapshot().settlement.acknowledged).toBe(true);
    controller.updateSettlement({ amount: '36' });
    expect(controller.getSnapshot().settlement.acknowledged).toBe(false);
    controller.acknowledgeSettlement(true);
    controller.acknowledgeSettlement(false);
    expect(controller.getSnapshot().settlement.acknowledged).toBe(false);
  });

  it('opens Record only from the Balances destination', async () => {
    const { controller } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().screen).toBe('group');
    expect(controller.getSnapshot().settlement.draft).toBeNull();
  });

  // #334, final review: names this phone knew of a Group the member has lost name no one.
  it.each(['gone', 'removed'] as const)(
    'names no one from what this phone knew once Check payment finds the member %s',
    async (refusal) => {
      let lose = true,
        refused = false;
      const { controller } = setup((path, init) => {
        if (path.endsWith('/settlements') && init.method === 'POST' && lose) {
          lose = false;
          return Promise.reject(new TypeError('Network request failed'));
        }
        if (refused && path === `/api/groups/${groupId}`)
          return refusal === 'gone'
            ? json({ status: 404, error: 'Group not found' }, 404)
            : json({
                status: 200,
                data: {
                  ...group,
                  members: group.members.filter(({ user }) => user._id !== actor),
                },
              });
        // Everything else under the Group is refused, as SplitBook refuses a non-member.
        if (refused && path.startsWith(`/api/groups/${groupId}/`))
          return json({ status: 403, error: 'Forbidden' }, 403);
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId, true, 'balances');
      await controller.openRecordPayment(actor, recipient, 'INR');
      await controller.recordSettlement();
      await controller.back();
      expect(controller.getSnapshot().pendingPayment).toMatchObject({ groupId });
      refused = true;
      await controller.openPendingPayment();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'settlement',
        settlement: { status: 'blocked', group: null, draft: { paidTo: recipient } },
      });
      expect(controller.getSnapshot().settlement.known).toEqual({});
    },
  );

  it('names no one from what this phone knew once a read behind the open sheet is refused', async () => {
    let hold = false,
      release!: (value: FetchResponse) => void,
      entered!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { controller } = setup((path) => {
      if (hold && path.endsWith('/expenses')) {
        hold = false;
        entered();
        return new Promise((resolve) => {
          release = resolve;
        });
      }
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    hold = true;
    const refreshing = controller.refreshExpenses();
    await held;
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      known: { [actor]: 'Alex', [recipient]: 'Sam' },
    });
    release(json({ status: 403, error: 'Access removed' }, 403));
    await refreshing;
    expect(controller.getSnapshot().settlement).toMatchObject({ group: null, balances: [] });
    expect(controller.getSnapshot().settlement.known).toEqual({});
  });

  // #334, review: Try again is for a check that couldn't run. Anywhere else it does nothing.
  it('checks again on Try again only after the sheet’s check couldn’t run, and otherwise sends and changes nothing', async () => {
    let down = false,
      denied = false,
      hold = false;
    let release!: (value: FetchResponse | Promise<never>) => void, entered!: () => void;
    const sent: string[] = [];
    const { controller } = setup((path, init) => {
      sent.push(`${init.method ?? 'GET'} ${path}`);
      if (down && path.startsWith('/api/groups/'))
        return Promise.reject(new TypeError('Network request failed'));
      if (denied && path.startsWith(`/api/groups/${groupId}`))
        return json({ status: 403, error: 'Access removed' }, 403);
      if (hold && path.endsWith('/settlements') && init.method === 'POST')
        return new Promise((resolve) => {
          release = resolve;
          entered();
        });
    });
    /** Try again in this state sends nothing and publishes nothing. */
    const ignored = async (state: string) => {
      const before = controller.getSnapshot(),
        from = sent.length;
      await controller.retrySettlementCheck();
      expect({ state, sent: sent.slice(from), same: controller.getSnapshot() === before }).toEqual({
        state,
        sent: [],
        same: true,
      });
    };
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement.status).toBe('editing');
    await ignored('editing');

    // The check couldn't run, and an invitation opened over the sheet: away from it, Try again
    // does nothing.
    await controller.back();
    down = true;
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement.status).toBe('error');
    down = false;
    await controller.openInvitation('http://localhost:4138/join/1234abcd');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      settlement: { status: 'error' },
    });
    await ignored('error, away from the sheet');

    // On the sheet, Try again runs the check again: the live Balances, over the Group its view
    // verified within 30 s (#333).
    await controller.openGroup(groupId, true, 'balances');
    down = true;
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement.status).toBe('error');
    down = false;
    const from = sent.length;
    await controller.retrySettlementCheck();
    expect(sent.slice(from)).toEqual([`GET /api/groups/${groupId}/balances`]);
    expect(controller.getSnapshot().settlement.status).toBe('editing');

    // Recording, then unconfirmed once its reply is lost.
    hold = true;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const saving = controller.recordSettlement();
    await dispatched;
    expect(controller.getSnapshot().settlement.status).toBe('saving');
    await ignored('saving');
    hold = false;
    release(Promise.reject(new TypeError('Network request failed')));
    await saving;
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    await ignored('uncertain');

    // Refused: access is gone, so there's nothing to check again.
    denied = true;
    await controller.openSettlements(groupId);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { status: 'blocked' },
    });
    await ignored('blocked');

    denied = false;
    await controller.signOut();
    await ignored('signed out');
  });

  // #334, review: the sheet showed Balances' ₹30 while it checked, then a ₹20 suggestion silently.
  it('says so when the sheet’s check finds another amount than Balances showed', async () => {
    let amount = 30;
    const { controller, writes } = setup((path) =>
      path === `/api/groups/${groupId}/balances` ? json(balances(amount)) : undefined,
    );
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    expect(controller.getSnapshot().financial.balances.data?.[0].debts[0].amount).toBe(30);
    amount = 20;
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      chosen: { shown: 30 },
      suggested: 20,
      draft: { amount: '20' },
      message:
        'The suggested amount changed since Balances showed it. Check the amount, then record it.',
    });
    // Closed, Balances show ₹20 too: opened again, the same amount says nothing.
    await controller.back();
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      chosen: { shown: 20 },
      suggested: 20,
      message: null,
    });
    expect(writes).toHaveLength(0);
  });

  // #334: after a network failure, Retry sends the first attempt's record again, never a new one.
  it('says a Retry that couldn’t reach SplitBook sent nothing, and that the first may already be recorded, then sends its key and revision again only on Retry', async () => {
    let down = false,
      posted = 0;
    const { controller, writes, records, connect } = setup((path, init) => {
      if (down && path.startsWith('/api/groups/'))
        return Promise.reject(new TypeError('Network request failed'));
      // The first payment's reply never arrives: SplitBook may have recorded it.
      if (path.endsWith('/settlements') && init.method === 'POST' && ++posted === 1)
        return Promise.reject(new TypeError('Network request failed'));
    });
    const sent = (init: RequestInit) => {
      const headers = new Headers(init.headers);
      return {
        key: headers.get('Idempotency-Key'),
        revision: headers.get('X-Splitbook-Revision'),
        body: init.body,
      };
    };
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.recordSettlement();
    expect(writes).toHaveLength(1);
    const first = sent(writes[0]);
    const attempt = { key: first.key, body: first.body };
    expect(first.key).toBe('settlement-key-1');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt,
      message:
        'This payment may already be recorded. Retry sends the same record, so it can’t be counted twice.',
    });

    // Retry while SplitBook can't be reached: its checks fail before the payment is sent. The
    // sheet says so, and that the first may already be recorded, still offering Retry with the
    // record kept: never read as a payment that wasn't recorded.
    down = true;
    await controller.recordSettlement();
    expect(writes).toHaveLength(1);
    const unreachableAndUnconfirmed =
      'Could not reach SplitBook. Check your connection and try again. This payment may already be recorded. Retry sends the same record, so it can’t be counted twice.';
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt,
      message: unreachableAndUnconfirmed,
    });
    expect([...records.values()]).toEqual([expect.objectContaining(attempt)]);

    // Closed, then opened again from Balances while SplitBook still can't be reached: the same.
    await controller.back();
    await controller.openPendingPayment();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { status: 'uncertain', attempt, message: unreachableAndUnconfirmed },
    });
    expect(writes).toHaveLength(1);

    // Nothing is sent by itself: not on a refresh, nor on reconnecting, nor once SplitBook
    // answers again.
    await controller.refresh('foreground');
    connect(false);
    down = false;
    connect(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.refresh('foreground');
    await controller.refresh('pull');
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot().settlement).toMatchObject({ status: 'uncertain', attempt });

    // Retry: the second payment carries the first one's key, body and revision.
    await controller.recordSettlement();
    expect(writes).toHaveLength(2);
    expect(sent(writes[1])).toEqual(first);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
      settlement: { attempt: null },
    });
  });
});

describe('the Record payment sheet reads only what it checks (#333)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const groupPath = `/api/groups/${groupId}`,
    balancesPath = `${groupPath}/balances`,
    paymentPath = `${groupPath}/settlements`;
  /** Requests sent since `from`, up to and with the payment, if one was sent. */
  const upTo = (sent: string[], from: number) => {
    const next = sent.slice(from),
      post = next.indexOf(`POST ${paymentPath}`);
    return post < 0 ? next : next.slice(0, post + 1);
  };
  const key = (init: RequestInit) => new Headers(init.headers).get('Idempotency-Key');
  const unreachable = 'Could not reach SplitBook. Check your connection and try again.';

  it('checks only the Balances over a Group its view verified within 30 s; past that, the Group, then the Balances once it has answered', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(iso));
    let gate = false,
      release: (() => void) | null = null;
    const { controller, sent } = setup((path) => {
      if (gate && path === groupPath)
        return new Promise<FetchResponse>((resolve) => {
          release = () => resolve(json({ status: 200, data: group }));
        });
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    let from = sent.length;
    await controller.openRecordPayment(actor, recipient, 'INR');
    expect(sent.slice(from)).toEqual([`GET ${balancesPath}`]);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      group: { id: groupId },
      draft: { paidBy: actor, paidTo: recipient, amount: '30' },
    });
    // Closed, Balances show what the sheet read: nothing is read again.
    from = sent.length;
    await controller.back();
    expect(sent.slice(from)).toEqual([]);

    // Past the window, the sheet reads the Group, and the Balances only after it (AMEND-1).
    vi.setSystemTime(Date.now() + 31_000);
    gate = true;
    from = sent.length;
    const opening = controller.openRecordPayment(actor, recipient, 'INR');
    await vi.waitFor(() => expect(release).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent.slice(from)).toEqual([`GET ${groupPath}`]);
    gate = false;
    release!();
    await opening;
    expect(sent.slice(from)).toEqual([`GET ${groupPath}`, `GET ${balancesPath}`]);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      draft: { amount: '30' },
    });
  });

  it('records after one live Balances read, the suggestion it checks, against the Group the sheet checked', async () => {
    const { controller, sent, writes } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    const from = sent.length;
    await controller.recordSettlement();
    expect(upTo(sent, from)).toEqual([`GET ${balancesPath}`, `POST ${paymentPath}`]);
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
    });
  });

  it('sends nothing when Record’s Balances read is refused, the lost Group goes, and nothing is sent later', async () => {
    let lost = false;
    const { controller, sent, writes, records } = setup((path) => {
      // Alex has lost the Group: SplitBook refuses every request under it.
      if (lost && path.startsWith(groupPath)) return json({ status: 403, error: 'Forbidden' }, 403);
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: '' });
    lost = true;
    const from = sent.length;
    await controller.recordSettlement();
    expect(upTo(sent, from)).toEqual([`GET ${balancesPath}`]);
    expect(writes).toHaveLength(0);
    expect(records.size).toBe(0);
    // The lost-access purge: the Group leaves Home, and the sheet names no one in it.
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      groups: { data: [] },
      settlement: { status: 'blocked', group: null, balances: [], known: {} },
    });
    await controller.refresh('foreground');
    await controller.back();
    await controller.refresh('pull');
    expect(sent.slice(from).filter((request) => !request.startsWith('GET '))).toEqual([]);
  });

  it('checks only the Balances before a payment and before its Retry, and tells a payment never sent from one that may be recorded', async () => {
    let down = false,
      posted = 0;
    const { controller, sent, writes, records } = setup((path, init) => {
      if (down && path.startsWith('/api/groups/'))
        return Promise.reject(new TypeError('Network request failed'));
      // The first payment's reply never arrives: SplitBook may have recorded it.
      if (path === paymentPath && init.method === 'POST' && ++posted === 1)
        return Promise.reject(new TypeError('Network request failed'));
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    await controller.openRecordPayment(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });

    // Its check can't reach SplitBook: never sent, and it says only that.
    down = true;
    let from = sent.length;
    await controller.recordSettlement();
    expect(sent.slice(from)).toEqual([`GET ${balancesPath}`]);
    expect(writes).toHaveLength(0);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      attempt: null,
      message: unreachable,
    });

    // Sent, its reply lost: it may be recorded.
    down = false;
    from = sent.length;
    await controller.recordSettlement();
    expect(upTo(sent, from)).toEqual([`GET ${balancesPath}`, `POST ${paymentPath}`]);
    const attempt = controller.getSnapshot().settlement.attempt;
    expect(attempt).not.toBeNull();

    // A Retry whose check can't reach SplitBook sends nothing, and says the first may be recorded.
    down = true;
    from = sent.length;
    await controller.recordSettlement();
    expect(sent.slice(from)).toEqual([`GET ${balancesPath}`]);
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt,
      message: `${unreachable} This payment may already be recorded. Retry sends the same record, so it can’t be counted twice.`,
    });

    // Retry: the Balances, then the first payment's key and body again.
    down = false;
    from = sent.length;
    await controller.recordSettlement();
    expect(upTo(sent, from)).toEqual([`GET ${balancesPath}`, `POST ${paymentPath}`]);
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toBe(writes[0].body);
    expect(key(writes[1])).toBe(key(writes[0]));
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
    });
  });

  it.each([
    [
      'INVALID_MEMBERS',
      'the payee has left the Group',
      'The payer or recipient is no longer a Group member. Close this and choose another payment.',
    ],
    [
      'CURRENCY_MISMATCH',
      'the Group’s currency has changed',
      'The Group currency changed. Close this and choose the payment again.',
    ],
  ] as const)(
    'ends a payment SplitBook refuses with %s, as %s: no Record for it again, and the Group is read again',
    async (code, _, correction) => {
      let changed = false;
      const { controller, sent, writes, records } = setup((path, init) => {
        if (!changed) return;
        if (path === paymentPath && init.method === 'POST')
          return json({ status: 422, code, error: 'Refused' }, 422);
        if (path === groupPath)
          return json({
            status: 200,
            data:
              code === 'INVALID_MEMBERS'
                ? {
                    ...group,
                    members: group.members.filter(({ user }) => user._id !== recipient),
                  }
                : { ...group, defaultCurrency: 'EUR' },
          });
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId, true, 'balances');
      await controller.openRecordPayment(actor, recipient, 'INR');
      expect(controller.getSnapshot().settlement).toMatchObject({ status: 'editing' });
      // Elsewhere, and within the 30 s the sheet reuses the view's Group for, the Group changes.
      changed = true;
      let from = sent.length;
      await controller.recordSettlement();
      const refused = sent.indexOf(`POST ${paymentPath}`, from);
      expect(upTo(sent, from)).toEqual([`GET ${balancesPath}`, `POST ${paymentPath}`]);
      // The correction shows; the payment is no longer offered, and its key is dropped: it was
      // sent and refused, so it can't be recorded.
      expect(controller.getSnapshot().settlement).toMatchObject({
        status: 'ready',
        draft: null,
        attempt: null,
        suggested: null,
        message: correction,
      });
      expect(records.size).toBe(0);
      // A second tap sends nothing, nor does choosing the same payment again on this sheet: it
      // offers nothing until it is closed.
      from = sent.length;
      await controller.recordSettlement();
      controller.selectSettlement(actor, recipient, 'INR');
      expect(controller.getSnapshot().settlement).toMatchObject({
        status: 'ready',
        draft: null,
        group: null,
        message: correction,
      });
      await controller.recordSettlement();
      expect(writes).toHaveLength(1);
      expect(sent.slice(from).filter((request) => !request.startsWith('GET '))).toEqual([]);
      // The Group is read again, at the latest by Close, so it's current there.
      await controller.back();
      expect(sent.slice(refused)).toContain(`GET ${groupPath}`);
      expect(controller.getSnapshot().detail.data).toMatchObject(
        code === 'INVALID_MEMBERS'
          ? { members: [{ user: { id: actor } }, { user: { id: other } }] }
          : { defaultCurrency: 'EUR' },
      );
      // Opened again, the sheet doesn't offer the refused payment.
      from = sent.length;
      await controller.openRecordPayment(actor, recipient, 'INR');
      expect(controller.getSnapshot().settlement).toMatchObject({ draft: null });
      expect(sent.slice(from).filter((request) => !request.startsWith('GET '))).toEqual([]);
      expect(writes).toHaveLength(1);
    },
  );

  it.each(['INVALID_MEMBERS', 'CURRENCY_MISMATCH', 'a refused Retry'] as const)(
    'on Close after a payment refused with %s, reads the Group before the Balances, and the Balances once',
    async (refusal) => {
      let changed = false,
        lose = refusal === 'a refused Retry',
        holdGroup = false,
        release: (() => void) | null = null;
      const code = refusal === 'CURRENCY_MISMATCH' ? 'CURRENCY_MISMATCH' : 'INVALID_MEMBERS';
      const { controller, sent } = setup((path, init) => {
        if (path === paymentPath && init.method === 'POST') {
          // A Retry's first payment: its reply never arrives.
          if (lose) {
            lose = false;
            return Promise.reject(new TypeError('Network request failed'));
          }
          if (changed) return json({ status: 422, code, error: 'Refused' }, 422);
        }
        if (path === groupPath && holdGroup)
          return new Promise<FetchResponse>((resolve) => {
            release = () => resolve(json({ status: 200, data: group }));
          });
      });
      await controller.signIn('alex');
      await controller.openGroup(groupId, true, 'balances');
      await controller.openRecordPayment(actor, recipient, 'INR');
      if (refusal === 'a refused Retry') {
        await controller.recordSettlement();
        expect(controller.getSnapshot().settlement).toMatchObject({ status: 'uncertain' });
      }
      changed = true;
      await controller.recordSettlement();
      expect(controller.getSnapshot().settlement.status).toBe(
        refusal === 'a refused Retry' ? 'blocked' : 'ready',
      );
      // The Group's reply is held: no Balances read may start while it is on its way.
      holdGroup = true;
      const from = sent.length;
      const closing = controller.back();
      await vi.waitFor(() => expect(release).not.toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sent.slice(from)).toContain(`GET ${groupPath}`);
      expect(sent.slice(from)).not.toContain(`GET ${balancesPath}`);
      holdGroup = false;
      release!();
      await closing;
      await new Promise((resolve) => setTimeout(resolve, 10));
      const after = sent.slice(from);
      expect(after.filter((request) => request === `GET ${balancesPath}`)).toHaveLength(1);
      expect(after.indexOf(`GET ${balancesPath}`)).toBeGreaterThan(
        after.indexOf(`GET ${groupPath}`),
      );
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        destination: 'balances',
        financial: { balances: { status: 'ready' } },
      });
    },
  );
});

afterEach(() => vi.useRealTimers());
it('forgets saved Group content when the payment check returns 200 without this member', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let left = false,
    offline = false;
  const { controller, sent } = setup((path) => {
    if (offline) return Promise.reject(new TypeError('Network request failed'));
    if (left && path === `/api/groups/${groupId}`)
      return json({ status: 200, data: { ...group, members: group.members.slice(1) } });
  }, true);
  await controller.signIn('alex');
  await controller.openGroup(groupId);
  await controller.back();
  left = true;
  vi.setSystemTime(Date.now() + 31_000);
  await controller.openSettlements(groupId);
  expect(controller.getSnapshot()).toMatchObject({
    groups: { data: [] },
    settlement: { status: 'blocked', group: null },
  });
  await controller.back();
  offline = true;
  const before = sent.length;
  await controller.openGroup(groupId);
  expect(controller.getSnapshot().detail.data).toBeNull();
  expect(controller.getSnapshot().financial.expenses.data).toEqual([]);
  expect(sent.slice(before).filter((request) => !request.startsWith('GET '))).toEqual([]);
});

it.each(['back', 'discard'] as const)(
  'removes a lost Group’s payment attempt only on deliberate %s',
  async (leave) => {
    let refused = false;
    const { controller, records, sent } = setup((path, init) => {
      if (refused && path === `/api/groups/${groupId}`)
        return json({ status: 403, error: 'Access removed' }, 403);
      if (path.endsWith('/settlements') && init.method === 'POST')
        return Promise.reject(new TypeError('Reply lost'));
    }, true);
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    await controller.recordSettlement();
    expect(records.size).toBe(1);
    refused = true;
    await controller.refresh('retry');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'blocked',
      attempt: { key: 'settlement-key-1' },
    });
    expect(records.size).toBe(1);
    const before = sent.length;
    if (leave === 'back') await controller.back();
    else await controller.discardUnconfirmedSettlement();
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(sent.slice(before).filter((request) => !request.startsWith('GET '))).toEqual([]);
  },
);

it('cleans the unlisted Group’s payment attempt after its own refusal on Home', async () => {
  let denied = false;
  const { controller, records, sent } = setup((path, init) => {
    if (denied && path === '/api/groups') return json({ status: 200, data: [] });
    if (denied && path === `/api/groups/${groupId}`)
      return json({ status: 404, error: 'Group gone' }, 404);
    if (path.endsWith('/settlements') && init.method === 'POST')
      return Promise.reject(new TypeError('Reply lost'));
  }, true);
  await controller.signIn('alex');
  await controller.openSettlements(groupId);
  controller.selectSettlement(actor, recipient, 'INR');
  await controller.recordSettlement();
  await controller.back();
  await controller.back();
  expect(records.size).toBe(1);
  denied = true;
  const before = sent.length;
  await controller.refresh('pull');
  expect(records.size).toBe(0);
  expect(
    sent.slice(before).filter((request) => request === `GET /api/groups/${groupId}`),
  ).toHaveLength(1);
  expect(sent.slice(before).filter((request) => !request.startsWith('GET '))).toEqual([]);
});
