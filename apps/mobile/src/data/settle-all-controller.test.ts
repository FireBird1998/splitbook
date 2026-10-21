import { createCheckedMobileController as createMobileController } from '../test-utils/flow-monitor';
import { describe, expect, it } from 'vitest';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { FetchResponse } from './types';

/**
 * Settle up with Sam (#734): one payment clears Alex's Debts to Sam in two currencies, one
 * Settlement for each, all recorded in one request or none (`/settlements/batch`). The
 * controller seam, with fake HTTP; the amounts are the shared `calculateSettlementBatch`'s.
 */
const alex = 'a00000000000000000000001',
  sam = 'a00000000000000000000002',
  priya = 'a00000000000000000000003';
const groupId = 'b00000000000000000000001',
  settlementId = 'c00000000000000000000001';
const iso = '2026-10-21T04:50:00.000Z';
const user = { id: alex, name: 'Alex Rivera', email: 'alex@example.test', image: null };
const people = [alex, sam, priya].map((_id, i) => ({
  _id,
  name: ['Alex Rivera', 'Sam Chen', 'Priya Shah'][i],
  email: `${i}@example.test`,
  image: null,
}));
const group = {
  _id: groupId,
  createdBy: alex,
  name: 'Lisbon & Tokyo',
  category: 'trip',
  defaultCurrency: 'INR',
  alternateCurrencies: ['EUR', 'JPY'],
  members: people.map((person) => ({ user: person, role: 'member', joinedAt: iso })),
  createdAt: iso,
  updatedAt: iso,
};
/** As the server sends them: alphabetically. Alex owes Sam €20.00 and ₹1,480.00. */
const balances = (euros = 20) => ({
  status: 200,
  data: {
    byCurrency: [
      {
        currency: 'EUR',
        balances: [],
        debts: euros ? [{ from: people[0], to: people[1], amount: euros }] : [],
      },
      { currency: 'INR', balances: [], debts: [{ from: people[0], to: people[1], amount: 1480 }] },
      { currency: 'JPY', balances: [], debts: [{ from: people[1], to: people[0], amount: 8400 }] },
    ],
  },
});
const json = (body: unknown, status = 200) => Response.json(body, { status });
/** Frankfurter's rates of 20 Oct, fetched at 06:00 in India the next day (#726). */
const frankfurter = (from: string, to: string, rate: string) => ({
  from,
  to,
  rate,
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: '2026-10-21T00:30:00.000Z',
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
  components: [],
});
const suggestions: Record<string, ReturnType<typeof frankfurter>> = {
  'EUR→INR': frankfurter('EUR', 'INR', '92.1'),
  'INR→EUR': frankfurter('INR', 'EUR', '0.010858'),
};
/** The Group's rate read: its suggestion for the pair, or none. */
const rates = (suggestion: unknown, reason = 'unavailable') =>
  json({
    status: 200,
    data: suggestion ? { suggestion } : { suggestion: null, reason },
  });
/** Nothing comes back: the phone has no connection. */
const offline = () => Promise.reject(new TypeError('Network request failed'));
/** Until the controller's snapshot satisfies `ready`. */
const until = (
  controller: ReturnType<typeof setup>['controller'],
  ready: (snapshot: ReturnType<ReturnType<typeof setup>['controller']['getSnapshot']>) => boolean,
) =>
  new Promise<void>((resolve) => {
    if (ready(controller.getSnapshot())) return resolve();
    const stop = controller.subscribe(() => {
      if (!ready(controller.getSnapshot())) return;
      stop();
      resolve();
    });
  });
/** The server's answer to a payment: what was sent, as it stores it. */
const recorded = (body: Record<string, unknown>) => ({
  _id: settlementId,
  group: groupId,
  createdBy: people[0],
  ...body,
  paidBy: people.find(({ _id }) => _id === body.paidBy),
  paidTo: people.find(({ _id }) => _id === body.paidTo),
  amountMinor: parseAmountMinor(body.amount as number, body.currency as string),
  moneyVersion: 1,
  createdAt: iso,
  updatedAt: iso,
});

/** The server's answer to a batch: each row recorded as a Settlement, in the order sent. */
const batchRecorded = (body: {
  paidBy: string;
  paidTo: string;
  paidCurrency: string;
  settlements: Record<string, unknown>[];
}) => {
  const settlements = body.settlements.map((row, index) => ({
    ...recorded({
      paidBy: body.paidBy,
      paidTo: body.paidTo,
      note: '',
      ...row,
      ...(row.amountPaidMinor === undefined ? {} : { paidCurrency: body.paidCurrency }),
    }),
    _id: `c0000000000000000000000${index + 1}`,
    pairDebtBeforeMinor: -parseAmountMinor(row.amount as number, row.currency as string),
    pairDebtAfterMinor: 0,
  }));
  return {
    paidCurrency: body.paidCurrency,
    totalPaidMinor: settlements.reduce(
      (sum, row) =>
        sum +
        ((row as { amountPaidMinor?: number }).amountPaidMinor ??
          (row as { amountMinor: number }).amountMinor),
      0,
    ),
    settlements,
  };
};

function setup(
  intercept: (
    url: URL,
    init: RequestInit,
  ) => FetchResponse | Promise<FetchResponse> | undefined = () => undefined,
) {
  let cookie: string | null = null,
    account: string | null = null,
    cleanup = false,
    key = 0;
  const records = new Map<string, unknown>();
  let cleanupRecord: unknown = null;
  const financialCleanup = {
    load: async () => structuredClone(cleanupRecord),
    save: async (value: unknown) => {
      cleanupRecord = structuredClone(value);
    },
    clear: async () => {
      cleanupRecord = null;
    },
  };
  const store = {
    list: async (owner: string) =>
      [...records]
        .filter(([id]) => id.startsWith(owner))
        .map(([id, value]) => ({ groupId: id.slice(owner.length), value: structuredClone(value) })),
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
  /** Each payment's body, as sent: a single one, or a batch's. */
  const payments: Record<string, unknown>[] = [];
  /** Each batch's body, as sent to `/settlements/batch`, with its key. */
  const batches: { key: string | null; body: Record<string, unknown> }[] = [];
  /** Every request sent, as `METHOD /path?query`, in the order sent. */
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
          financialCleanup,
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
          stores: [store, financialCleanup],
        },
        fetch: async (address, init) => {
          const url = new URL(address);
          const path = url.pathname;
          sent.push(`${init.method ?? 'GET'} ${path}${url.search}`);
          if (path.endsWith('/settlements') && init.method === 'POST')
            payments.push(JSON.parse(String(init.body)));
          if (path.endsWith('/settlements/batch') && init.method === 'POST')
            batches.push({
              key: new Headers(init.headers).get('Idempotency-Key'),
              body: JSON.parse(String(init.body)),
            });
          const override = intercept(url, init);
          if (override) return override;
          if (path.endsWith('/sign-in'))
            return new Response(JSON.stringify({ user }), {
              headers: {
                'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000',
              },
            });
          if (path.endsWith('/get-session'))
            return json({ user, session: { userId: alex, expiresAt: '2030-01-01T00:00:00Z' } });
          if (path === '/api/groups') return json({ status: 200, data: [group] });
          if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
          if (path.endsWith('/user/balances')) return json({ status: 200, data: { buckets: [] } });
          if (path === `/api/groups/${groupId}/rates`)
            return rates(
              suggestions[`${url.searchParams.get('from')}→${url.searchParams.get('to')}`] ?? null,
            );
          if (path.endsWith('/balances')) return json(balances());
          if (path.endsWith('/settlements/batch') && init.method === 'POST')
            return json({ status: 201, data: batchRecorded(JSON.parse(String(init.body))) }, 201);
          if (path.endsWith('/settlements'))
            return init.method === 'POST'
              ? json({ status: 201, data: recorded(JSON.parse(String(init.body))) }, 201)
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
  return { controller: create(), create, records, payments, batches, sent, connect };
}

describe('settling up in several currencies at once (#734)', () => {
  const batchPath = `POST /api/groups/${groupId}/settlements/batch`;
  /** Alex's Debts to Sam, in rupees and euros, open on the sheet. */
  const opened = async (intercept?: Parameters<typeof setup>[0]) => {
    const harness = setup(intercept);
    await harness.controller.signIn('alex');
    await harness.controller.openSettlements(groupId);
    await harness.controller.selectSettleAll(alex, sam);
    return harness;
  };
  const fromFrankfurter = {
    suggestedRate: '92.1',
    rateSource: 'frankfurter',
    rateAsOf: '2026-10-20',
    rateFetchedAt: '2026-10-21T00:30:00.000Z',
  };
  /** The two Debts as Alex pays them in rupees, at Frankfurter's rate for euros. */
  const inRupees = {
    paidBy: alex,
    paidTo: sam,
    paidCurrency: 'INR',
    settlements: [
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184200,
        appliedRate: '92.1',
        rateKind: 'suggested',
        ...fromFrankfurter,
      },
    ],
  };

  it('settles both Debts in one payment, each at its own rate, all in one request', async () => {
    const { controller, batches, payments, sent, records } = await opened();
    expect(sent).toContain(`GET /api/groups/${groupId}/rates?from=EUR&to=INR`);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      batch: {
        paidBy: alex,
        paidTo: sam,
        paidCurrency: 'INR',
        // The Group's order: its main currency first.
        debts: [
          { currency: 'INR', amount: 1480 },
          { currency: 'EUR', amount: 20 },
        ],
        rates: { EUR: { rate: { status: 'ready', suggestion: { rate: '92.1' } }, custom: null } },
      },
    });
    await controller.recordSettlement();
    expect(payments).toEqual([]);
    expect(batches).toEqual([{ key: 'settlement-key-1', body: inRupees }]);
    expect(sent.filter((request) => request.startsWith('POST'))).toEqual([
      'POST /api/auth/demo-persona/sign-in',
      batchPath,
    ]);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
    });
  });

  it('pays in the other currency: its own Debt needs no rate, the other one its own', async () => {
    const { controller, batches, sent } = await opened();
    await controller.choosePaidCurrency('EUR');
    expect(sent).toContain(`GET /api/groups/${groupId}/rates?from=INR&to=EUR`);
    expect(controller.getSnapshot().settlement.batch).toMatchObject({
      paidCurrency: 'EUR',
      rates: { INR: { rate: { status: 'ready' } } },
    });
    expect(controller.getSnapshot().settlement.batch?.rates.EUR).toBeUndefined();
    await controller.recordSettlement();
    const [row, plain] = (batches[0]?.body.settlements ?? []) as Record<string, unknown>[];
    expect(batches[0]?.body.paidCurrency).toBe('EUR');
    // ₹1,480.00 at €0.010858 for each rupee is €16.06984, which rounds to €16.07.
    expect(row).toMatchObject({
      currency: 'INR',
      amount: 1480,
      amountPaidMinor: 1607,
      rateKind: 'suggested',
      suggestedRate: '0.010858',
    });
    expect(String(row?.appliedRate)).toMatch(/^0\.0108581081/);
    expect(plain).toEqual({ amount: 20, currency: 'EUR' });
  });

  it('records the member’s own rate for one Debt beside its suggestion, and puts the suggestion back', async () => {
    const { controller, batches } = await opened();
    controller.editBatchRate('EUR', '92.50');
    expect(controller.getSnapshot().settlement.batch?.rates.EUR?.custom).toBe('92.50');
    controller.restoreBatchRate('EUR');
    expect(controller.getSnapshot().settlement.batch?.rates.EUR?.custom).toBeNull();
    controller.editBatchRate('EUR', '92.50');
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 185000,
        appliedRate: '92.5',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  it('with no suggested rate for a Debt, waits for the one the member agreed, recorded as entered', async () => {
    const { controller, batches } = await opened(({ pathname }) =>
      pathname.endsWith('/rates') ? rates(null) : undefined,
    );
    expect(controller.getSnapshot().settlement.batch?.rates.EUR).toEqual({
      rate: { status: 'none', reason: 'unavailable' },
      custom: null,
    });
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(controller.getSnapshot().settlement.message).toBe(
      'Enter the rate for the EUR Debt to record it.',
    );
    controller.editBatchRate('EUR', '92.40');
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184800,
        appliedRate: '92.4',
        rateKind: 'entered',
      },
    ]);
  });

  it('offline, waits for a connection and records nothing; connected again, looks the rate up', async () => {
    let down = true;
    const { controller, batches, connect } = await opened(({ pathname }) =>
      down && pathname.endsWith('/rates') ? offline() : undefined,
    );
    expect(controller.getSnapshot().settlement.batch?.rates.EUR?.rate).toEqual({
      status: 'unreachable',
    });
    controller.editBatchRate('EUR', '92.40');
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(controller.getSnapshot().settlement.message).toBe(
      'Recording a payment needs a connection.',
    );
    down = false;
    connect(false);
    connect(true);
    await until(controller, (now) => now.settlement.batch?.rates.EUR?.rate.status === 'ready');
    // The member's own rate stays theirs, beside the suggestion now known.
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184800,
        appliedRate: '92.4',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  it('when a Debt changed meanwhile, shows it and waits to be recorded again', async () => {
    let euros = 20;
    const { controller, batches } = await opened(({ pathname }) =>
      pathname === `/api/groups/${groupId}/balances` ? json(balances(euros)) : undefined,
    );
    euros = 15;
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      message: 'The Debts changed. Check the payment, then record again.',
      batch: {
        debts: [
          { currency: 'INR', amount: 1480 },
          { currency: 'EUR', amount: 15 },
        ],
      },
    });
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 15,
        currency: 'EUR',
        amountPaidMinor: 138150,
        appliedRate: '92.1',
        rateKind: 'suggested',
        ...fromFrankfurter,
      },
    ]);
  });

  it('ends when a Debt is gone by the time it’s recorded, and sends nothing', async () => {
    let euros = 20;
    const { controller, batches, records } = await opened(({ pathname }) =>
      pathname === `/api/groups/${groupId}/balances` ? json(balances(euros)) : undefined,
    );
    euros = 0;
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      batch: null,
      message: 'This suggested payment has changed. Close this to see the latest balances.',
    });
  });

  it('ends when Splitbook finds a Debt gone, and keeps nothing to retry', async () => {
    const { controller, batches, records } = await opened(({ pathname }, init) =>
      pathname.endsWith('/settlements/batch') && init.method === 'POST'
        ? json(
            {
              status: 422,
              code: 'NO_SETTLEMENT_DEBT',
              error: 'There is no Debt to settle in EUR.',
            },
            422,
          )
        : undefined,
    );
    await controller.recordSettlement();
    expect(batches).toHaveLength(1);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      batch: null,
      attempt: null,
      message: 'These Debts changed. Close this and check them again.',
    });
    expect(records.size).toBe(0);
  });

  it('never sends it twice: a lost reply is retried with the same key and body, after a restart too', async () => {
    let posts = 0;
    const { controller, batches, create, records } = await opened(({ pathname }, init) =>
      pathname.endsWith('/settlements/batch') && init.method === 'POST' && ++posts === 1
        ? Promise.reject(new Error('Response lost'))
        : undefined,
    );
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    controller.dispose();
    const restarted = create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    // The payment found on this phone is the batch, with what it pays.
    expect(restarted.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: {
        paidBy: alex,
        paidTo: sam,
        currency: 'INR',
        amount: '3322',
        batch: inRupees.settlements,
      },
    });
    await restarted.recordSettlement();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(batches[0]);
    expect(records.size).toBe(0);
    expect(restarted.getSnapshot().snackbar?.message).toBe('Payment recorded');
  });

  it.each<[string, (data: ReturnType<typeof batchRecorded>) => void]>([
    [
      'pays another amount for a Debt',
      (data) => {
        data.settlements[1] = {
          ...data.settlements[1]!,
          amountPaidMinor: 185000,
        } as (typeof data.settlements)[number];
      },
    ],
    [
      'clears another amount of a Debt',
      (data) => {
        Object.assign(data.settlements[0]!, { amount: 1400, amountMinor: 140000 });
      },
    ],
    [
      'pays another total',
      (data) => {
        data.totalPaidMinor += 1;
      },
    ],
    [
      'lists its Settlements in another order',
      (data) => {
        data.settlements.reverse();
      },
    ],
    [
      'pays in another currency',
      (data) => {
        data.paidCurrency = 'EUR';
      },
    ],
    [
      'leaves a Settlement out',
      (data) => {
        data.settlements.pop();
      },
    ],
  ])('keeps it unconfirmed when the reply %s', async (_, change) => {
    const { controller, records } = await opened(({ pathname }, init) => {
      if (!pathname.endsWith('/settlements/batch') || init.method !== 'POST') return undefined;
      const data = batchRecorded(JSON.parse(String(init.body)));
      change(data);
      return json({ status: 201, data }, 201);
    });
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt: { key: 'settlement-key-1' },
    });
    expect(records.size).toBe(1);
  });

  it('is only for Debts between the same two people, one way, in two currencies or more', async () => {
    const { controller } = setup(({ pathname }) =>
      pathname === `/api/groups/${groupId}/balances` ? json(balances(0)) : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    // Only rupees are owed to Sam now; Priya is owed nothing.
    await controller.selectSettleAll(alex, sam);
    await controller.selectSettleAll(alex, priya);
    expect(controller.getSnapshot().settlement).toMatchObject({ status: 'ready', batch: null });
  });

  it('opens from Balances, checking the latest balances first', async () => {
    const { controller, sent } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    const from = sent.length;
    await controller.openSettleAll(alex, sam);
    expect(sent.slice(from)).toContain(`GET /api/groups/${groupId}/balances`);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { status: 'editing', batch: { paidBy: alex, paidTo: sam } },
    });
  });
});
