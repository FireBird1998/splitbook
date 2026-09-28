import { describe, expect, it } from 'vitest';
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
) {
  let cookie: string | null = null,
    account: string | null = null,
    cleanup = false,
    key = 0;
  const records = new Map<string, unknown>();
  const store = {
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
  return { controller: create(), create, store, records, writes };
}
describe('native payment recording', () => {
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
    await controller.reviewSettlement();
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

  it('keeps an interrupted payment review usable after a warm invitation', async () => {
    let hold = false,
      release!: (value: FetchResponse) => void;
    const { controller } = setup((path) =>
      hold && path === `/api/groups/${groupId}`
        ? new Promise((resolve) => {
            release = resolve;
          })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    hold = true;
    const pending = controller.reviewSettlement();
    await controller.openInvitation('http://localhost:4138/join/1234abcd');
    release(json({ status: 200, data: group }));
    await pending;
    expect(controller.getSnapshot().settlement.status).toBe('editing');
    expect(controller.getSnapshot().screen).toBe('invite');
  });
  it.each(['offline', 'storage'] as const)(
    'does not send or queue a payment when %s is unavailable',
    async (failure) => {
      let offline = false;
      const { controller, store, writes, records } = setup((path) =>
        offline && path === `/api/groups/${groupId}`
          ? Promise.reject(new Error('Offline'))
          : undefined,
      );
      await controller.signIn('alex');
      await controller.openSettlements(groupId);
      controller.selectSettlement(actor, recipient, 'INR');
      await controller.reviewSettlement();
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
    await controller.reviewSettlement();
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
    await controller.reviewSettlement();
    const saving = controller.recordSettlement();
    await dispatched;
    expect(records.size).toBe(1);
    await controller.signOut();
    release(json({ status: 201, data: record }, 201));
    await saving;
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      draft: null,
      attempt: null,
      history: [],
    });
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
  });

  it('unlocks a definitively rejected new submission for correction without losing input', async () => {
    const { controller, records } = setup((path, init) =>
      path.endsWith('/settlements') && init.method === 'POST'
        ? json({ status: 422, code: 'CURRENCY_MISMATCH', error: 'Currency changed' }, 422)
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.reviewSettlement();
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
    const { controller, writes, records } = setup((path, init) => {
      if (path === `/api/groups/${groupId}` && denied)
        return json({ status: 403, error: 'Access removed' }, 403);
      if (path.endsWith('/settlements') && init.method === 'POST')
        return rejectReplay
          ? json({ status: 422, code: 'INVALID_MEMBERS', error: 'Membership changed' }, 422)
          : Promise.reject(new Error('Lost response'));
    });
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    await controller.reviewSettlement();
    denied = true;
    await controller.recordSettlement();
    expect(writes).toHaveLength(0);
    expect(controller.getSnapshot().settlement.status).toBe('blocked');
    denied = false;
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    await controller.reviewSettlement();
    await controller.recordSettlement();
    const attempt = controller.getSnapshot().settlement.attempt;
    expect(attempt).not.toBeNull();
    rejectReplay = true;
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('blocked');
    expect(controller.getSnapshot().settlement.attempt).toEqual(attempt);
    expect(records.size).toBe(1);
  });

  it('restores an immutable unresolved payment and retries the identical key/body only on explicit action', async () => {
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
      if (path.endsWith('/settlements'))
        return json({ status: 200, data: committed ? [record] : [] });
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json(balances(committed ? 20 : 30));
    });
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.reviewSettlement();
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    expect(records.size).toBe(1);
    const restarted = create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    await restarted.refresh();
    expect(restarted.getSnapshot().screen).toBe('settlement');
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
    expect(restarted.getSnapshot().settlement.status).toBe('ready');
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
    await controller.reviewSettlement();
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

  it.each([
    { endpoint: 'balances', status: 503 },
    { endpoint: 'settlements', status: 503 },
    { endpoint: 'balances', status: 403 },
  ])(
    'retains confirmed payment and $endpoint refresh failure ($status)',
    async ({ endpoint, status }) => {
      let committed = false;
      const { controller, records, writes } = setup((path, init) => {
        if (path.endsWith('/settlements') && init.method === 'POST') {
          committed = true;
          return json({ status: 201, data: record }, 201);
        }
        if (committed && path === `/api/groups/${groupId}/${endpoint}`)
          return json({ status, error: 'Payment refresh unavailable' }, status);
      });
      await controller.signIn('alex');
      await controller.openSettlements(groupId);
      controller.selectSettlement(actor, recipient, 'INR');
      controller.updateSettlement({ amount: '10', note: 'Paid already' });
      await controller.reviewSettlement();
      await controller.recordSettlement();
      expect(writes).toHaveLength(1);
      expect(records.size).toBe(0);
      const state = controller.getSnapshot().settlement;
      expect(state.status).toBe(status === 403 ? 'blocked' : 'error');
      expect(state.attempt).toBeNull();
      expect(state.message).toContain('Payment recorded.');
      expect(state.message).toContain(
        status === 403
          ? 'You no longer have access to this group.'
          : 'The server could not complete this request. Please try again.',
      );
      expect(state.message).toContain('Use Refresh payments');
      expect(state.message).not.toContain('refreshed balances show');
      await controller.recordSettlement();
      expect(writes).toHaveLength(1);
    },
  );

  it('does not replace a newer payment review message when an older success refresh finishes', async () => {
    let committed = false,
      held = false;
    let release!: (value: FetchResponse) => void, entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
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
    });
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.reviewSettlement();
    const saving = controller.recordSettlement();
    await dispatched;
    controller.openSettings();
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '5' });
    await controller.reviewSettlement();
    const reviewed = controller.getSnapshot().settlement;
    release(json(balances(20)));
    await saving;
    expect(controller.getSnapshot().settlement).toEqual(reviewed);
  });

  it('persists the exact actual payment before recording and refreshes history and balances', async () => {
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
      if (path.endsWith('/settlements'))
        return json({ status: 200, data: committed ? [record] : [] });
      if (path.endsWith('/balances') && !path.endsWith('/user/balances'))
        return json(balances(committed ? 20 : 30));
    });
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(actor, recipient, 'INR');
    controller.updateSettlement({ amount: '10', note: 'Paid already' });
    await controller.reviewSettlement();
    await controller.recordSettlement();
    expect(writes).toHaveLength(1);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      draft: null,
      attempt: null,
      history: [{ _id: settlementId }],
      balances: [{ debts: [{ amount: 20 }] }],
    });
  });

  it('refreshes the suggested debt for review while retaining a partial actual payment', async () => {
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
    await controller.reviewSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      suggested: 25,
      draft: { amount: '10', paidBy: actor, paidTo: recipient, currency: 'INR' },
    });
    expect(writes).toHaveLength(0);
  });
});
