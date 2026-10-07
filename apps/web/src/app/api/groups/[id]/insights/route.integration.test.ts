/**
 * Integration tests for a Group's insights read (`GET /api/groups/[id]/insights`, #314) against
 * a real, isolated MongoDB database (`splitbook-test-group-insights`). Only the session is a
 * stand-in, and only `Date` is faked: the read runs on 15 September 2026 at 06:00 UTC.
 *
 * It answers members only, with the Group reads' refusal; adds recurring Expenses that have
 * fallen due first (while the switch, #289, is on) and counts them only then; buckets Months
 * in the zone the client sends and refuses an unknown one; leaves the Month out of its own
 * average; and keeps a legacy Group's other currencies apart.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { parseGroupInsightsResponse } from '@splitbook/shared/group-insights-read';
import { GET } from './route';
import { GET as getBalances } from '../balances/route';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? { user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' } }
          : null,
      ),
    },
  },
}));

const db = integrationTestDb('group-insights');
const { alice, bob, carol, dave } = TEST_USER_IDS;
const NOW = new Date('2026-09-15T06:00:00.000Z');

beforeAll(async () => {
  await db.connect();
  await Expense.createIndexes();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = alice;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(db.teardown);

/** Recurring Expenses are off unless the variable is exactly `true`. */
function switchRecurringExpenses(on: boolean) {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', on ? 'true' : undefined);
}

const context = (groupId: string) => ({ params: Promise.resolve({ id: groupId }) });

async function read(groupId: string, query = 'month=2026-09&compare=6&tz=Asia%2FKolkata') {
  const response = await GET(
    new Request(`http://localhost/api/groups/${groupId}/insights?${query}`),
    context(groupId),
  );
  return { status: response.status, body: await response.json() };
}

async function readBalances(groupId: string) {
  const response = await getBalances(
    new Request(`http://localhost/api/groups/${groupId}/balances`),
    context(groupId),
  );
  return { status: response.status, body: await response.json() };
}

async function createGroup(
  name: string,
  members: string[],
  { category = 'home', currency = 'INR' }: { category?: 'trip' | 'home'; currency?: string } = {},
) {
  const group = await groupService.create(
    { name, category, defaultCurrency: currency, alternateCurrencies: [] },
    members[0],
  );
  const groupId = String(group._id);
  for (const member of members.slice(1)) await groupService.addMember(groupId, member);
  return groupId;
}

/** Make the Group as old as a Household with history: created in March. */
async function createdIn(groupId: string, date: string) {
  await mongoose.connection
    .db!.collection('groups')
    .updateOne({ _id: oid(groupId) }, { $set: { createdAt: new Date(date) } });
}

const oid = (id: string) => new mongoose.Types.ObjectId(id);
let sequence = 0;

/**
 * A stored Expense, written as the database holds it: `shares` maps each person to their share
 * in minor units, and `paid` to what they paid (the first person in `shares` by default). A
 * legacy Expense has no minor units.
 */
async function insertExpense(
  groupId: string,
  date: string,
  shares: Record<string, number>,
  {
    paid,
    currency = 'INR',
    legacy = false,
    isDeleted = false,
    description = 'Synthetic expense',
  }: {
    paid?: Record<string, number>;
    currency?: string;
    legacy?: boolean;
    isDeleted?: boolean;
    description?: string;
  } = {},
) {
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const payers = paid ?? { [Object.keys(shares)[0]]: totalMinor };
  const money = (amountMinor: number) =>
    legacy ? { amount: amountMinor / 100 } : { amount: amountMinor / 100, amountMinor };
  const _id = new mongoose.Types.ObjectId();
  sequence += 1;
  await mongoose.connection.db!.collection('expenses').insertOne({
    _id,
    group: oid(groupId),
    description: `${description}`,
    ...money(totalMinor),
    ...(legacy ? {} : { moneyVersion: 1 }),
    currency,
    category: 'food',
    date: new Date(date),
    paidBy: Object.entries(payers).map(([user, minor]) => ({ user: oid(user), ...money(minor) })),
    splitMethod: 'exact',
    splitBetween: Object.entries(shares).map(([user, minor]) => ({
      user: oid(user),
      ...money(minor),
    })),
    tag: 'General',
    createdBy: oid(Object.keys(payers)[0]),
    isDeleted,
    revision: 0,
    createdAt: new Date(NOW.getTime() + sequence),
    updatedAt: NOW,
  });
  return String(_id);
}

interface MonthRead {
  month: string;
  spentMinor: number;
  expenseCount: number;
  yourShareMinor: number;
  youPaidMinor: number;
  recurringCount?: number;
}
const column = (months: MonthRead[], field: keyof MonthRead) => months.map((month) => month[field]);

describe('a member', () => {
  it("gets the Group's Months, exact, with their own share and what they paid", async () => {
    const maple = await createGroup('Maple House', [alice, bob, carol]);
    await createdIn(maple, '2026-03-02T10:00:00Z');
    // A third of ₹1,000.00 each, so the shares only add up exactly in minor units.
    await insertExpense(maple, '2026-09-02T06:00:00Z', {
      [bob]: 33334,
      [alice]: 33333,
      [carol]: 33333,
    });
    await insertExpense(
      maple,
      '2026-09-05T06:00:00Z',
      { [alice]: 100000, [bob]: 100000, [carol]: 100000 },
      { paid: { [carol]: 200000, [alice]: 100000 }, description: 'Cook (September)' },
    );
    await insertExpense(maple, '2026-08-11T06:00:00Z', { [alice]: 1, [bob]: 2 });
    await insertExpense(maple, '2026-04-11T06:00:00Z', { [carol]: 90000 });
    // Deleted.
    await insertExpense(maple, '2026-09-06T06:00:00Z', { [alice]: 99999 }, { isDeleted: true });

    const { status, body } = await read(maple);

    expect(status).toBe(200);
    const insights = parseGroupInsightsResponse(body);
    expect(insights).toMatchObject({
      timeZone: 'Asia/Kolkata',
      month: '2026-09',
      compare: 6,
      firstMonth: '2026-03',
      currency: 'INR',
      window: { from: '2026-03-01', to: '2026-09-30' },
      otherCurrencies: [],
      hasExpenses: true,
      recurringExpenses: false,
    });
    expect(column(insights.months, 'month')).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(insights.months.at(-1)).toEqual({
      month: '2026-09',
      spentMinor: 400000,
      expenseCount: 2,
      yourShareMinor: 133333,
      youPaidMinor: 100000,
    });
    expect(column(insights.months, 'spentMinor')).toEqual([0, 90000, 0, 0, 0, 3, 400000]);
    expect(insights.biggestExpense).toEqual({
      id: expect.any(String),
      description: 'Cook (September)',
      amountMinor: 300000,
      date: '2026-09-05T06:00:00.000Z',
      paidBy: [
        { id: carol, name: 'Carol Tester' },
        { id: alice, name: 'Alice Tester' },
      ],
    });
    // Names only: no member's email anywhere in the answer.
    expect(JSON.stringify(body)).not.toContain('@splitbook-test.local');
  });

  it('leaves the Month out of its own average', async () => {
    const maple = await createGroup('Maple House', [alice, bob]);
    await createdIn(maple, '2026-03-02T10:00:00Z');
    for (const [month, total] of [
      ['04', 1698000],
      ['05', 1764000],
      ['06', 1921000],
      ['07', 1805000],
      ['08', 1738500],
    ] as const)
      await insertExpense(maple, `2026-${month}-10T06:00:00Z`, { [alice]: total });
    await insertExpense(maple, '2026-09-10T06:00:00Z', { [alice]: 1842000 });

    const { body } = await read(maple, 'month=2026-09&compare=5&tz=Asia%2FKolkata');

    // April to August: ₹89,265.00 over five Months. September is not in it.
    expect(body.data.average).toEqual({
      monthCount: 5,
      spentMinor: 1785300,
      yourShareMinor: 1785300,
      youPaidMinor: 1785300,
    });
    expect(body.data.change).toEqual({
      direction: 'up',
      differenceMinor: 56700,
      changePercent: 3.2,
    });
  });

  it('compares with only the Months since the Group started, and none in its first', async () => {
    const young = await createGroup('Lakeview Flat', [alice, bob]);
    await createdIn(young, '2026-07-20T10:00:00Z');
    await insertExpense(young, '2026-08-10T06:00:00Z', { [alice]: 3000 });
    await insertExpense(young, '2026-09-10T06:00:00Z', { [alice]: 1500 });

    const twelve = (await read(young, 'month=2026-09&compare=12&tz=UTC')).body.data;
    expect(twelve.firstMonth).toBe('2026-07');
    expect(column(twelve.months, 'month')).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(twelve.average).toMatchObject({ monthCount: 2, spentMinor: 1500 });
    expect(twelve.change).toEqual({ direction: 'level', differenceMinor: 0, changePercent: 0 });

    const first = (await read(young, 'month=2026-07&compare=6&tz=UTC')).body.data;
    expect(column(first.months, 'month')).toEqual(['2026-07']);
    expect(first.average).toBeNull();
    expect(first.change).toBeNull();
  });

  it('starts the Group at an Expense dated before it was created', async () => {
    const backdated = await createGroup('Goa Friends Trip', [alice, bob], { category: 'trip' });
    await insertExpense(backdated, '2026-05-20T06:00:00Z', { [alice]: 700 });

    const { body } = await read(backdated, 'month=2026-09&compare=12&tz=UTC');

    expect(body.data.firstMonth).toBe('2026-05');
    expect(column(body.data.months, 'spentMinor')).toEqual([700, 0, 0, 0, 0]);
  });

  it('buckets Months in the zone sent, never the server’s', async () => {
    const maple = await createGroup('Maple House', [alice, bob]);
    await createdIn(maple, '2026-03-02T10:00:00Z');
    // 20:00 UTC on 31 August: 1 September in Kolkata, still 31 August in New York.
    await insertExpense(maple, '2026-08-31T20:00:00Z', { [alice]: 4200 });

    const kolkata = (await read(maple, 'month=2026-09&compare=1&tz=Asia%2FKolkata')).body.data;
    const newYork = (await read(maple, 'month=2026-09&compare=1&tz=America%2FNew_York')).body.data;

    expect(column(kolkata.months, 'spentMinor')).toEqual([0, 4200]);
    expect(column(newYork.months, 'spentMinor')).toEqual([4200, 0]);
    expect(kolkata.biggestExpense).toMatchObject({ amountMinor: 4200 });
    expect(newYork.biggestExpense).toBeNull();
  });

  it('reads the current Month in the zone sent, and compares six by default', async () => {
    vi.setSystemTime(new Date('2026-09-30T20:00:00.000Z'));
    const maple = await createGroup('Maple House', [alice, bob]);

    const kolkata = (await read(maple, 'tz=Asia%2FKolkata')).body.data;
    expect(kolkata).toMatchObject({ month: '2026-10', compare: 6, firstMonth: '2026-10' });
    expect((await read(maple, 'tz=UTC')).body.data).toMatchObject({ month: '2026-09' });
  });

  it('sees "no Expenses yet" in a new Group: one empty Month, nothing to compare', async () => {
    const fresh = await createGroup('Sunday Football', [alice, bob]);

    const { status, body } = await read(fresh);

    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      firstMonth: '2026-09',
      hasExpenses: false,
      average: null,
      change: null,
      biggestExpense: null,
      months: [
        { month: '2026-09', spentMinor: 0, expenseCount: 0, yourShareMinor: 0, youPaidMinor: 0 },
      ],
    });
  });
});

describe('only members', () => {
  it('refuses a non-member exactly as the Group’s other reads do', async () => {
    const theirs = await createGroup('Sunday Football', [bob, carol]);
    await insertExpense(theirs, '2026-09-05T12:00:00Z', { [bob]: 1000, [alice]: 500 });

    const insights = await read(theirs);
    expect(insights).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    expect(insights).toEqual(await readBalances(theirs));
  });

  it('refuses a member who has left, exactly as the Group’s other reads do', async () => {
    const left = await createGroup('Old Flat', [bob, alice]);
    await insertExpense(left, '2026-08-05T12:00:00Z', { [alice]: 7000, [bob]: 7000 });
    expect((await read(left)).status).toBe(200);
    // Leaving takes the member off the Group's list; their Expenses stay in its ledger.
    await Group.updateOne({ _id: left }, { $pull: { members: { user: oid(alice) } } });

    const insights = await read(left);
    expect(insights).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    expect(insights).toEqual(await readBalances(left));
  });

  it('refuses a Group that does not exist as one the member is not in', async () => {
    const missing = 'f00000000000000000000000';
    expect(await read(missing)).toEqual(await readBalances(missing));
    expect((await read(missing)).status).toBe(403);
  });

  it('refuses a non-member before reading the query, so a bad query tells them nothing', async () => {
    const theirs = await createGroup('Sunday Football', [bob, carol]);
    expect((await read(theirs, 'tz=Mars%2FPhobos&month=soon')).status).toBe(403);
  });

  it('gives each member their own share of the same Months', async () => {
    const maple = await createGroup('Maple House', [alice, bob, dave]);
    await insertExpense(maple, '2026-09-05T12:00:00Z', { [alice]: 1000, [bob]: 3000 });

    session.userId = bob;
    expect((await read(maple)).body.data.months.at(-1)).toMatchObject({
      spentMinor: 4000,
      yourShareMinor: 3000,
      youPaidMinor: 0,
    });
    session.userId = dave;
    expect((await read(maple)).body.data.months.at(-1)).toMatchObject({
      spentMinor: 4000,
      yourShareMinor: 0,
      youPaidMinor: 0,
    });
  });
});

describe('a legacy Group with Expenses in two currencies', () => {
  it("counts only the Group's currency and lists the others, never converted", async () => {
    const lisbon = await createGroup('Lisbon Offsite', [alice, bob], { currency: 'EUR' });
    await insertExpense(
      lisbon,
      '2026-09-05T12:00:00Z',
      { [alice]: 1275, [bob]: 1275 },
      { currency: 'EUR', legacy: true },
    );
    // Written before one currency per Group.
    await insertExpense(lisbon, '2026-09-06T12:00:00Z', { [alice]: 150000, [bob]: 150000 });
    await insertExpense(
      lisbon,
      '2026-08-06T12:00:00Z',
      { [alice]: 1001, [bob]: 999 },
      { currency: 'INR', legacy: true },
    );

    const { status, body } = await read(lisbon, 'month=2026-09&compare=1&tz=UTC');

    expect(status).toBe(200);
    expect(body.data.currency).toBe('EUR');
    expect(column(body.data.months, 'spentMinor')).toEqual([0, 2550]);
    expect(column(body.data.months, 'expenseCount')).toEqual([0, 1]);
    expect(body.data.biggestExpense).toMatchObject({ amountMinor: 2550 });
    expect(body.data.otherCurrencies).toEqual([
      { currency: 'INR', spentMinor: 302000, expenseCount: 2 },
    ]);
  });
});

describe('recurring Expenses that have fallen due', () => {
  /** A Household whose Rent template started in July, with nothing generated yet. */
  async function householdWithRent() {
    const household = await createGroup('Lakeview Flat', [alice, bob, carol]);
    await createdIn(household, '2026-06-20T10:00:00Z');
    const each = { amount: 1000, amountMinor: 100000 };
    await RecurringExpense.create({
      group: household,
      description: 'Rent',
      amount: 3000,
      amountMinor: 300000,
      moneyVersion: 1,
      currency: 'INR',
      category: 'housing',
      tag: 'Rent',
      paidBy: [{ user: alice, amount: 3000, amountMinor: 300000 }],
      splitMethod: 'equal',
      splitBetween: [alice, bob, carol].map((user) => ({ user, ...each })),
      dayOfMonth: 5,
      startsOn: new Date('2026-07-05T00:00:00.000Z'),
      createdBy: alice,
    });
    await insertExpense(household, '2026-09-08T06:00:00Z', { [bob]: 2000 });
    return household;
  }

  it('adds them before totalling while the switch is on, and counts them', async () => {
    switchRecurringExpenses(true);
    const household = await householdWithRent();

    const { status, body } = await read(household, 'month=2026-09&compare=6&tz=Asia%2FKolkata');

    expect(status).toBe(200);
    expect(body.data.recurringExpenses).toBe(true);
    expect(column(body.data.months, 'month')).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(column(body.data.months, 'spentMinor')).toEqual([0, 300000, 300000, 302000]);
    expect(column(body.data.months, 'expenseCount')).toEqual([0, 1, 1, 2]);
    expect(column(body.data.months, 'recurringCount')).toEqual([0, 1, 1, 1]);
    expect(column(body.data.months, 'youPaidMinor')).toEqual([0, 300000, 300000, 300000]);
    expect(await Expense.countDocuments({ group: household, period: { $ne: null } })).toBe(3);
  });

  it('adds none while the switch is off, gives no recurring count, and changes nothing stored', async () => {
    switchRecurringExpenses(false);
    const household = await householdWithRent();

    const { status, body } = await read(household, 'month=2026-09&compare=6&tz=Asia%2FKolkata');

    expect(status).toBe(200);
    expect(body.data.recurringExpenses).toBe(false);
    expect(column(body.data.months, 'spentMinor')).toEqual([0, 0, 0, 2000]);
    for (const month of body.data.months) expect(month).not.toHaveProperty('recurringCount');
    expect(await Expense.countDocuments({ group: household })).toBe(1);
    expect(await RecurringExpense.findOne({ group: household }).lean()).toMatchObject({
      lastGeneratedFor: null,
    });
  });

  it('still counts, but does not mark, Expenses recurring Expenses added before the switch went off', async () => {
    switchRecurringExpenses(true);
    const household = await householdWithRent();
    await read(household);
    switchRecurringExpenses(false);

    const { body } = await read(household, 'month=2026-09&compare=6&tz=Asia%2FKolkata');

    expect(column(body.data.months, 'expenseCount')).toEqual([0, 1, 1, 2]);
    for (const month of body.data.months) expect(month).not.toHaveProperty('recurringCount');
  });
});

describe('requests it refuses', () => {
  let maple: string;
  beforeEach(async () => {
    maple = await createGroup('Maple House', [alice, bob]);
  });

  it.each([
    ['no time zone', 'month=2026-09'],
    ['an empty time zone', 'month=2026-09&tz='],
    ['an unknown time zone', 'month=2026-09&tz=Mars%2FPhobos'],
    ['a fixed offset', 'month=2026-09&tz=%2B05%3A30'],
  ])('%s', async (_label, query) => {
    const { status, body } = await read(maple, query);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'Send a named IANA time zone, such as Asia/Kolkata.',
      code: 'INVALID_TIME_ZONE',
      status: 400,
    });
  });

  it.each(['2026-13', '2026-9', '2026-09-01', 'September', '0000-06'])(
    'the Month %s',
    async (month) => {
      const { status, body } = await read(maple, `month=${month}&tz=UTC`);
      expect(status).toBe(400);
      expect(body).toEqual({
        error: 'Send a Month as YYYY-MM, such as 2026-09.',
        code: 'INVALID_MONTH',
        status: 400,
      });
    },
  );

  it.each(['0', '13', 'six', '2.5'])('an earlier-Month count of %s', async (compare) => {
    const { status, body } = await read(maple, `compare=${compare}&tz=UTC`);
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'INVALID_COMPARE' });
  });

  it('a signed-out request', async () => {
    session.userId = null;
    expect(await read(maple)).toEqual({
      status: 401,
      body: { error: 'Unauthorized', status: 401 },
    });
  });
});
