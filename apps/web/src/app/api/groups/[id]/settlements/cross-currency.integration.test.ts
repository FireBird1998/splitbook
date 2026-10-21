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
import { parseUserActivityResponse } from '@splitbook/shared/user-activity-read';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);
const db = integrationTestDb('cross-currency-settlements');
const { alex, sam } = DEMO_PERSONA_IDS;
let settlements: typeof import('./route');
let balances: typeof import('../balances/route');
let activity: typeof import('../activity/route');
let homeActivity: typeof import('@/app/api/user/activity/route');
let leave: typeof import('../leave/route');
let cookie: string;

beforeAll(async () => {
  await connectSignedIn(db);
  await requireReplicaSet();
  settlements = await import('./route');
  balances = await import('../balances/route');
  activity = await import('../activity/route');
  homeActivity = await import('@/app/api/user/activity/route');
  leave = await import('../leave/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  cookie = await signIn('sam');
});
afterAll(() => disconnectSignedIn(db));

async function trip(inr = false) {
  const group = await groupService.create(
    {
      name: 'Fictional Lisbon trip',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: ['EUR', 'JPY', 'KRW'],
    },
    alex,
  );
  const id = String(group._id);
  await groupService.addMember(id, sam);
  for (const currency of inr ? ['EUR', 'INR'] : ['EUR']) {
    await expenseService.create(
      id,
      {
        description: 'Fictional dinner',
        amount: 40,
        currency,
        category: 'food',
        tag: 'Food',
        date: new Date('2026-10-21T12:00:00Z'),
        paidBy: [{ user: alex, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
      alex,
    );
  }
  return id;
}
const rateFields = {
  amountPaidMinor: 185000,
  paidCurrency: 'INR',
  appliedRate: '92.5',
  suggestedRate: '92.1',
  rateSource: 'frankfurter',
  rateAsOf: '2026-10-21',
  rateFetchedAt: '2026-10-21T00:15:00.000Z',
  rateKind: 'custom',
};
const payment = { paidBy: sam, paidTo: alex, amount: 20, currency: 'EUR', ...rateFields };
function record(id: string, body: object = payment, key = 'cross-currency-0001') {
  return callRoute(settlements.POST, {
    method: 'POST',
    path: `/api/groups/${id}/settlements`,
    params: { id },
    cookie,
    body,
    headers: { 'Idempotency-Key': key },
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
    debtsBeforeSimplifying: unknown[];
  }[];
}
function leaveGroup(id: string) {
  return callRoute(leave.POST, {
    method: 'POST',
    path: `/api/groups/${id}/leave`,
    params: { id },
    cookie,
    body: {},
  });
}

describe('cross-currency Settlement HTTP contract (#727)', () => {
  it('stores both amounts and every rate field once, moving only the cleared currency', async () => {
    const id = await trip(true);
    const before = await ledgers(id);
    const saved = await record(id);
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({
      amount: 20,
      amountMinor: 2000,
      currency: 'EUR',
      ...rateFields,
    });
    const retry = await record(id);
    expect(retry.status).toBe(201);
    expect(retry.body.data._id).toBe(saved.body.data._id);
    const listed = await read(id);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ _id: saved.body.data._id, ...rateFields });
    const after = await ledgers(id);
    expect(after.find((row) => row.currency === 'INR')).toEqual(
      before.find((row) => row.currency === 'INR'),
    );
    expect(after.find((row) => row.currency === 'EUR')?.balances.map((row) => row.balance)).toEqual(
      [0, 0],
    );
    expect(after.find((row) => row.currency === 'EUR')?.debts).toEqual([]);
    expect(after.find((row) => row.currency === 'EUR')?.debtsBeforeSimplifying).toEqual([]);
    expect(
      (await record(id, { ...payment, amountPaidMinor: 186000, appliedRate: '93' })).status,
    ).toBe(409);
    expect((await read(id)).body.data).toHaveLength(1);
    const page = await callRoute(activity.GET, {
      method: 'GET',
      path: `/api/groups/${id}/activity`,
      params: { id },
      cookie,
    });
    const events = parseActivityPageResponse(page.body).activities.filter(
      (event) => event.type === 'settlement_recorded',
    );
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      settlementId: saved.body.data._id,
      amountMinor: 2000,
      currency: 'EUR',
      ...rateFields,
    });
    const home = await callRoute(homeActivity.GET, {
      method: 'GET',
      path: '/api/user/activity',
      cookie,
    });
    expect(
      parseUserActivityResponse(home.body).activities.find(
        (event) => event.type === 'settlement_recorded',
      )?.metadata,
    ).toMatchObject({ amountMinor: 2000, ...rateFields });
  });
  it('settles an extra-currency balance and lets the member leave without a manual currency conversion', async () => {
    const id = await trip();
    expect((await leaveGroup(id)).body.code).toBe('OPEN_BALANCE');
    expect((await record(id)).status).toBe(201);
    expect((await read(id)).body.data[0]).toMatchObject(rateFields);
    expect((await leaveGroup(id)).status).toBe(200);
  });
  it('refuses an unlisted paid currency without recording anything', async () => {
    const id = await trip();
    const refused = await record(id, { ...payment, paidCurrency: 'USD' });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('CURRENCY_MISMATCH');
    expect((await read(id)).body.data).toEqual([]);
  });
  it.each([
    { rateKind: 'entered', amountPaidMinor: 3150, paidCurrency: 'JPY', appliedRate: '157.5' },
    { rateKind: 'entered', amountPaidMinor: 30000, paidCurrency: 'KRW', appliedRate: '1500' },
    {
      ...rateFields,
      rateKind: 'suggested',
      amountPaidMinor: 184200,
      appliedRate: '92.1',
      rateSource: 'exchange-rate-api',
    },
    { ...rateFields, rateSource: 'mixed' },
  ])(
    'keeps a $rateKind payment in $paidCurrency with source $rateSource unchanged on retry',
    async (fields) => {
      const id = await trip();
      const body = { paidBy: sam, paidTo: alex, amount: 20, currency: 'EUR', ...fields };
      expect((await record(id, body)).status).toBe(201);
      expect((await record(id, body)).body.data).toMatchObject(fields);
      expect((await read(id)).body.data).toHaveLength(1);
      expect((await read(id)).body.data[0]).toMatchObject(fields);
    },
  );
  it('keeps partial clears and overpayments in the cleared currency', async () => {
    const id = await trip();
    const entered = {
      paidBy: sam,
      paidTo: alex,
      currency: 'EUR',
      paidCurrency: 'INR',
      rateKind: 'entered',
      appliedRate: '92.5',
    };
    expect((await record(id, { ...entered, amount: 5, amountPaidMinor: 46250 })).status).toBe(201);
    expect(
      (await ledgers(id))
        .find((row) => row.currency === 'EUR')
        ?.balances.find((row) => row.user._id === sam)?.balance,
    ).toBe(-15);
    expect(
      (await record(id, { ...entered, amount: 16, amountPaidMinor: 148000 }, 'cross-currency-0002'))
        .status,
    ).toBe(201);
    expect(
      (await ledgers(id))
        .find((row) => row.currency === 'EUR')
        ?.balances.find((row) => row.user._id === sam)?.balance,
    ).toBe(1);
  });
  it.each([
    { amountPaidMinor: undefined },
    { paidCurrency: undefined },
    { appliedRate: undefined },
    { rateKind: undefined },
    { amountPaidMinor: 1.5 },
    { amountPaidMinor: 0 },
    { appliedRate: '93' },
    { appliedRate: '0' },
    { paidCurrency: 'EUR' },
    { suggestedRate: undefined },
    { rateSource: undefined },
    { rateAsOf: '2026-02-30' },
    { rateFetchedAt: 'not a time' },
    { rateKind: 'entered' },
    { rateKind: 'suggested' },
  ])('refuses incomplete or inconsistent cross-currency fields: %j', async (change) => {
    const id = await trip();
    expect((await record(id, { ...payment, ...change })).status).toBe(422);
    expect((await read(id)).body.data).toEqual([]);
  });
});
