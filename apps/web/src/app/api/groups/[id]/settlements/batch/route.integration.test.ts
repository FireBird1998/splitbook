import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  requireReplicaSet,
  signIn,
} from '@/lib/test-utils/signed-in-route';
import { parseActivityPageResponse } from '@splitbook/shared/activity-page-read';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);
const db = integrationTestDb('settlement-batch');
const { alex, sam, priya } = DEMO_PERSONA_IDS;
let batch: typeof import('./route');
let settlements: typeof import('../route');
let balances: typeof import('../../balances/route');
let activity: typeof import('../../activity/route');
let userActivity: typeof import('@/app/api/user/activity/route');
let expenses: typeof import('../../expenses/route');
let currencies: typeof import('../../currencies/route');
let currency: typeof import('../../currencies/[code]/route');
let cookie: string;
beforeAll(async () => {
  await connectSignedIn(db);
  await requireReplicaSet();
  batch = await import('./route');
  settlements = await import('../route');
  balances = await import('../../balances/route');
  activity = await import('../../activity/route');
  userActivity = await import('@/app/api/user/activity/route');
  expenses = await import('../../expenses/route');
  currencies = await import('../../currencies/route');
  currency = await import('../../currencies/[code]/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  cookie = await signIn('sam');
});
afterAll(() => disconnectSignedIn(db));
const eur = {
  currency: 'EUR',
  amount: 20,
  amountPaidMinor: 185000,
  appliedRate: '92.5',
  rateKind: 'custom',
  suggestedRate: '92.1',
  rateSource: 'frankfurter',
  rateAsOf: '2026-10-20',
  rateFetchedAt: '2026-10-21T00:15:00.000Z',
};
const payment = {
  paidBy: sam,
  paidTo: alex,
  paidCurrency: 'INR',
  settlements: [{ currency: 'INR', amount: 20 }, eur],
};
async function trip(expenseAmount = 40, currencies = ['EUR', 'INR', 'JPY']) {
  const group = await groupService.create(
    {
      name: 'Fictional batch trip',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: ['EUR', 'JPY'],
    },
    alex,
  );
  const id = String(group._id);
  await groupService.addMember(id, sam);
  for (const currency of currencies) {
    await expenseService.create(
      id,
      {
        description: 'Fictional dinner',
        amount: expenseAmount,
        currency,
        category: 'food',
        tag: 'Food',
        date: new Date('2026-10-21T12:00:00Z'),
        paidBy: [{ user: alex, amount: expenseAmount }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
      alex,
    );
  }
  return id;
}
function record(id: string, body: object = payment, key: string | null = 'batch-payment-0001') {
  return callRoute(batch.POST, {
    method: 'POST',
    path: `/api/groups/${id}/settlements/batch`,
    params: { id },
    cookie,
    body,
    headers: key ? { 'Idempotency-Key': key } : {},
  });
}
function read(id: string) {
  return callRoute(settlements.GET, {
    method: 'GET',
    path: `/api/groups/${id}/settlements`,
    params: { id },
    cookie,
  });
}
async function ledgers(id: string) {
  const result = await callRoute(balances.GET, {
    method: 'GET',
    path: `/api/groups/${id}/balances`,
    params: { id },
    cookie,
  });
  expect(result.status).toBe(200);
  return result.body.data.byCurrency as {
    currency: string;
    balances: { user: { _id: string }; balance: number }[];
    debts: unknown[];
  }[];
}
async function events(id: string) {
  const result = await callRoute(activity.GET, {
    method: 'GET',
    path: `/api/groups/${id}/activity`,
    params: { id },
    cookie,
  });
  expect(result.status).toBe(200);
  return parseActivityPageResponse(result.body).activities.filter(
    (event) => event.type === 'settlement_recorded',
  );
}
describe('Settlement batch HTTP contract (#734)', () => {
  it('links both batch Activity events to the first Settlement and replays without new events', async () => {
    const id = await trip();
    const saved = await record(id);
    expect(saved.status).toBe(201);
    const batchId = saved.body.data.settlements[0]._id;
    const log = await events(id);
    expect(log).toHaveLength(2);
    for (const event of log) expect(event.metadata).toMatchObject({ batchId, batchSize: 2 });
    // Clients read a batch in the order it was recorded by its Settlement ids, which ascend in the
    // request's order (groupSettlementBatches).
    const ids = saved.body.data.settlements.map((row: { _id: string }) => row._id);
    expect(ids).toEqual([...ids].sort());

    // Latest changes must retain the same reference, not just the Group's Activity page.
    const latest = await callRoute(userActivity.GET, {
      method: 'GET',
      path: '/api/user/activity?limit=50',
      cookie,
    });
    expect(latest.status).toBe(200);
    const latestPayments = latest.body.data.activities.filter(
      (event: { type: string }) => event.type === 'settlement_recorded',
    );
    expect(latestPayments).toHaveLength(2);
    for (const event of latestPayments)
      expect(event.metadata).toMatchObject({ batchId, batchSize: 2 });

    expect((await record(id)).body).toEqual(saved.body);
    expect(await events(id)).toEqual(log);
  });

  it('marks a one-row batch but leaves a single-route Settlement event without a batch reference', async () => {
    const id = await trip();
    const saved = await record(id, {
      ...payment,
      settlements: [{ currency: 'INR', amount: 20 }],
    });
    expect(saved.status).toBe(201);
    const batchId = saved.body.data.settlements[0]._id;
    expect((await events(id))[0].metadata).toMatchObject({ batchId, batchSize: 1 });

    const single = await callRoute(settlements.POST, {
      method: 'POST',
      path: `/api/groups/${id}/settlements`,
      params: { id },
      cookie,
      body: { paidTo: alex, currency: 'JPY', amount: 20 },
    });
    expect(single.status).toBe(201);
    const singleEvent = (await events(id)).find(
      (event) => event.metadata?.settlementId === single.body.data._id,
    );
    expect(singleEvent).toBeDefined();
    expect(singleEvent!.metadata).not.toHaveProperty('batchId');
    expect(singleEvent!.metadata).not.toHaveProperty('batchSize');
  });

  it('never records a batch paid in a currency removed while the request is running', async () => {
    const adminCookie = await signIn('alex');
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const outcomes = new Set<string>();
    for (let round = 0; round < 12; round += 1) {
      // Yen is listed but unused until the batch pays both Debts in it.
      const id = await trip(40, ['EUR', 'INR']);
      const request = {
        paidBy: sam,
        paidTo: alex,
        paidCurrency: 'JPY',
        settlements: [
          {
            currency: 'INR',
            amount: 20,
            amountPaidMinor: 2000,
            appliedRate: '100',
            rateKind: 'entered',
          },
          {
            currency: 'EUR',
            amount: 20,
            amountPaidMinor: 3250,
            appliedRate: '162.5',
            rateKind: 'entered',
          },
        ],
      };
      const [removal, paid] = await Promise.all([
        // The removal starts later each round, so it lands both before and after the batch's
        // currency check: a check moved outside the batch's own mutation fails one side.
        pause(round * 5).then(() =>
          callRoute(currency.DELETE, {
            method: 'DELETE',
            path: `/api/groups/${id}/currencies/JPY`,
            params: { id, code: 'JPY' },
            cookie: adminCookie,
          }),
        ),
        record(id, request),
      ]);
      const settings = await callRoute(currencies.GET, {
        method: 'GET',
        path: `/api/groups/${id}/currencies`,
        params: { id },
        cookie,
      });
      const saved = await read(id);
      const label = `round ${round}: removal ${removal.status}, payment ${paid.status}`;
      outcomes.add(paid.status === 201 ? 'paid first' : 'removed first');
      expect(settings.status, label).toBe(200);
      expect(saved.status, label).toBe(200);
      const listed = settings.body.data.extraCurrencies.some(
        (row: { code: string }) => row.code === 'JPY',
      );
      expect([200, 409], label).toContain(removal.status);
      expect([201, 422], label).toContain(paid.status);
      expect(listed, label).toBe(removal.status !== 200);
      if (paid.status === 201) {
        expect(listed, label).toBe(true);
        expect(saved.body.data, label).toHaveLength(2);
        expect(saved.body.data, label).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ currency: 'INR', paidCurrency: 'JPY' }),
            expect.objectContaining({ currency: 'EUR', paidCurrency: 'JPY' }),
          ]),
        );
      } else {
        expect(paid.body.code, label).toBe('CURRENCY_MISMATCH');
        expect(saved.body.data, label).toEqual([]);
        expect(await events(id), label).toEqual([]);
      }
    }
    // Both orders happened, so the test reaches the race and not one side of it.
    expect([...outcomes].sort()).toEqual(['paid first', 'removed first']);
  });
  it('records two currencies atomically with immutable pair figures and one Activity event each', async () => {
    const id = await trip();
    const before = await ledgers(id);
    const saved = await record(id);
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({
      paidCurrency: 'INR',
      totalPaidMinor: 187000,
      settlements: [
        { currency: 'INR', amountMinor: 2000, pairDebtBeforeMinor: -2000, pairDebtAfterMinor: 0 },
        {
          ...eur,
          paidCurrency: 'INR',
          amountMinor: 2000,
          pairDebtBeforeMinor: -2000,
          pairDebtAfterMinor: 0,
        },
      ],
    });
    expect(saved.body.data.settlements[0]).not.toHaveProperty('paidCurrency');
    const after = await ledgers(id);
    expect(after.find((row) => row.currency === 'JPY')).toEqual(
      before.find((row) => row.currency === 'JPY'),
    );
    for (const currency of ['EUR', 'INR']) {
      expect(
        after.find((row) => row.currency === currency)?.balances.map((row) => row.balance),
      ).toEqual([0, 0]);
      expect(after.find((row) => row.currency === currency)?.debts).toEqual([]);
    }
    expect((await read(id)).body.data).toHaveLength(2);
    const log = await events(id);
    expect(log).toHaveLength(2);
    expect(log.map((event) => event.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'INR',
          amountMinor: 2000,
          pairDebtBeforeMinor: -2000,
          pairDebtAfterMinor: 0,
        }),
        expect.objectContaining({
          ...eur,
          amountMinor: 2000,
          pairDebtBeforeMinor: -2000,
          pairDebtAfterMinor: 0,
        }),
      ]),
    );
  });
  it('records three currencies with per-row rates and preserves partial pair figures after later writes', async () => {
    const id = await trip();
    const request = {
      ...payment,
      settlements: [
        { currency: 'INR', amount: 5 },
        { ...eur, amount: 5, amountPaidMinor: 46250 },
        {
          currency: 'JPY',
          amount: 20,
          amountPaidMinor: 1200,
          appliedRate: '0.6',
          rateKind: 'entered',
        },
      ],
    };
    const saved = await record(id, request);
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({
      totalPaidMinor: 47950,
      settlements: [
        { currency: 'INR', pairDebtBeforeMinor: -2000, pairDebtAfterMinor: -1500 },
        {
          currency: 'EUR',
          pairDebtBeforeMinor: -2000,
          pairDebtAfterMinor: -1500,
          amountPaidMinor: 46250,
          rateKind: 'custom',
          rateAsOf: '2026-10-20',
        },
        {
          currency: 'JPY',
          pairDebtBeforeMinor: -20,
          pairDebtAfterMinor: 0,
          amountPaidMinor: 1200,
          rateKind: 'entered',
        },
      ],
    });
    expect(
      (
        await record(
          id,
          { ...payment, settlements: [{ currency: 'INR', amount: 15 }] },
          'later-payment-0002',
        )
      ).status,
    ).toBe(201);
    expect((await record(id, request)).body).toEqual(saved.body);
    expect((await read(id)).body.data).toHaveLength(4);
  });
  it('accepts a recipient recording a routed Suggested payment while keeping the raw pair figures', async () => {
    const id = await trip();
    await groupService.addMember(id, priya);
    for (const currency of ['EUR', 'INR']) {
      await expenseService.create(
        id,
        {
          description: 'Fictional ticket for Alex',
          amount: 20,
          currency,
          category: 'food',
          tag: 'Food',
          date: new Date('2026-10-21T12:00:00Z'),
          paidBy: [{ user: priya, amount: 20 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alex }],
        },
        priya,
      );
    }
    cookie = await signIn('priya');
    const saved = await record(id, { ...payment, paidTo: priya });
    expect(saved.status).toBe(201);
    expect(saved.body.data.settlements).toMatchObject([
      { currency: 'INR', pairDebtBeforeMinor: 0, pairDebtAfterMinor: 2000 },
      { currency: 'EUR', pairDebtBeforeMinor: 0, pairDebtAfterMinor: 2000 },
    ]);
    for (const currency of ['EUR', 'INR'])
      expect((await ledgers(id)).find((row) => row.currency === currency)?.debts).toEqual([]);
  });
  it('replays the whole response once, including concurrent retries, and refuses a changed key payload', async () => {
    const id = await trip();
    const [first, concurrent] = await Promise.all([record(id), record(id)]);
    expect(first.status).toBe(201);
    expect(concurrent.status).toBe(201);
    expect(concurrent.body).toEqual(first.body);
    expect((await record(id)).body).toEqual(first.body);
    expect(
      (await record(id, { ...payment, settlements: [{ currency: 'INR', amount: 10 }, eur] }))
        .status,
    ).toBe(409);
    expect((await read(id)).body.data).toHaveLength(2);
    expect(await events(id)).toHaveLength(2);
  });
  it.each([
    { ...eur, currency: 'GBP' },
    { ...eur, appliedRate: '93' },
    { ...eur, amount: 0 },
    { ...eur, amountPaidMinor: 1.5 },
  ])(
    'records nothing when the second Debt has an invalid currency, rate or amount: %j',
    async (invalid) => {
      const id = await trip();
      const before = await ledgers(id);
      expect(
        (await record(id, { ...payment, settlements: [payment.settlements[0], invalid] })).status,
      ).toBe(422);
      expect((await read(id)).body.data).toEqual([]);
      expect(await events(id)).toEqual([]);
      expect(await ledgers(id)).toEqual(before);
    },
  );
  it('refuses non-members and a member who is not the payer or recipient of the Debt', async () => {
    const id = await trip();
    cookie = await signIn('priya');
    expect((await record(id)).status).toBe(403);
    await groupService.addMember(id, priya);
    expect((await record(id)).status).toBe(422);
    expect((await record(id, { ...payment, paidBy: priya })).body.code).toBe('NO_SETTLEMENT_DEBT');
    expect((await record(id, { ...payment, paidBy: alex, paidTo: sam })).status).toBe(422);
    expect((await read(id)).body.data).toEqual([]);
  });
  it('refuses duplicate cleared currencies before two partial payments can record anything', async () => {
    const id = await trip(80); // Sam owes Alex €40; both €10 rows would otherwise be valid.
    const before = await ledgers(id);
    expect(before.find((row) => row.currency === 'EUR')?.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: expect.objectContaining({ _id: sam }), balance: -40 }),
      ]),
    );
    const partial = { ...eur, amount: 10, amountPaidMinor: 92500 };
    const refused = await record(id, { ...payment, settlements: [partial, partial] });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('VALIDATION_ERROR');
    expect((await read(id)).body.data).toEqual([]);
    expect(await events(id)).toEqual([]);
    expect(await ledgers(id)).toEqual(before);
  });
  it('requires one retry key and one row per currency, with a listed paying currency', async () => {
    const id = await trip();
    expect((await record(id, payment, null)).body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect((await record(id, { ...payment, settlements: [eur, eur] })).status).toBe(422);
    expect(
      (await record(id, { ...payment, paidCurrency: 'GBP', settlements: [eur] })).body.code,
    ).toBe('CURRENCY_MISMATCH');
    expect((await read(id)).body.data).toEqual([]);
  });
  it('serializes the whole batch against an Expense save in one of its currencies', async () => {
    const outcomes = new Set<number>();
    for (let round = 0; round < 8; round++) {
      const id = await trip();
      const offset = () =>
        callRoute(expenses.POST, {
          method: 'POST',
          path: `/api/groups/${id}/expenses`,
          params: { id },
          cookie,
          headers: { 'Idempotency-Key': 'offset-expense-0001' },
          body: {
            description: 'Fictional offsetting dinner',
            amount: 20,
            currency: 'EUR',
            category: 'food',
            tag: 'Food',
            date: '2026-10-21',
            paidBy: [{ user: sam, amount: 20 }],
            splitMethod: 'equal',
            splitBetween: [{ user: alex }],
          },
        });
      const save = () => record(id);
      let created, saved;
      if (round === 0) {
        created = await offset();
        saved = await save();
      } else if (round === 1) {
        saved = await save();
        created = await offset();
      } else if (round % 2) [created, saved] = await Promise.all([offset(), save()]);
      else [saved, created] = await Promise.all([save(), offset()]);
      expect(created.status).toBe(201);
      expect([201, 422]).toContain(saved.status);
      outcomes.add(saved.status);
      const rows = (await read(id)).body.data;
      const current = await ledgers(id);
      const own = (currency: string) =>
        current
          .find((row) => row.currency === currency)
          ?.balances.find((row) => row.user._id === sam)?.balance;
      if (saved.status === 201) {
        expect(rows).toHaveLength(2);
        expect(saved.body.data.settlements[1]).toMatchObject({
          pairDebtBeforeMinor: -2000,
          pairDebtAfterMinor: 0,
        });
        expect(own('INR')).toBe(0);
        expect(own('EUR')).toBe(20);
      } else {
        expect(saved.body.code).toBe('NO_SETTLEMENT_DEBT');
        expect(rows).toEqual([]);
        expect(own('INR')).toBe(-20);
        expect(own('EUR')).toBe(0);
      }
    }
    expect([...outcomes].sort()).toEqual([201, 422]);
  });
});
