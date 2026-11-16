/**
 * Integration tests for Spending by day (`GET /api/user/spending/days`, #1273) against a real,
 * isolated MongoDB database (`splitbook-test-spending-by-day`). Only the session is a stand-in,
 * and only `Date` is faked: the read runs on 16 November 2026 at 06:00 UTC.
 *
 * It gives one Month of the member's own share across their current, non-archived Groups, per
 * currency and day, with the Expenses behind it; leaves out deleted Expenses, Settlements and
 * Expenses the member has no share in; agrees with the monthly spending read; reads one Month
 * through the Expenses index; and refuses a Month outside the twelve it allows.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import User from '@/lib/models/User';
import { groupService } from '@/lib/services/group.service';
import { settlementService } from '@/lib/services/settlement.service';
import { spendingByDayFilter } from '@/lib/services/spending-by-day.service';
import { parseSpendingByDayResponse } from '@splitbook/shared/spending-by-day-read';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { GET as readMonthly } from '../route';
import { GET } from './route';

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

const db = integrationTestDb('spending-by-day');
const { alice, bob, carol, dave } = TEST_USER_IDS;
const NOW = new Date('2026-11-16T06:00:00.000Z');

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

async function read(query = 'month=2026-11&tz=Asia%2FKolkata') {
  const response = await GET(new Request(`http://localhost/api/user/spending/days?${query}`));
  return { status: response.status, body: await response.json() };
}

async function createGroup(
  name: string,
  members: string[],
  { category = 'trip' }: { category?: 'trip' | 'home' } = {},
) {
  const group = await groupService.create(
    { name, category, defaultCurrency: 'INR', alternateCurrencies: [] },
    members[0],
  );
  const groupId = String(group._id);
  for (const member of members.slice(1)) await groupService.addMember(groupId, member);
  return groupId;
}

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/**
 * A stored Expense, written as the database holds it: `shares` maps each person to their share
 * in minor units. `payers` maps who paid to how much; by default the first sharer paid it all.
 * A legacy Expense has no minor units. Returns its id.
 */
async function insertExpense(
  groupId: string,
  date: string,
  shares: Record<string, number>,
  {
    currency = 'INR',
    legacy = false,
    isDeleted = false,
    description = 'Synthetic expense',
    tag = 'General',
    payers,
    createdAt = NOW,
  }: {
    currency?: string;
    legacy?: boolean;
    isDeleted?: boolean;
    description?: string;
    tag?: string;
    payers?: Record<string, number>;
    createdAt?: Date;
  } = {},
) {
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const money = (amountMinor: number) =>
    legacy ? { amount: amountMinor / 100 } : { amount: amountMinor / 100, amountMinor };
  const paid = payers ?? { [Object.keys(shares)[0]]: totalMinor };
  const { insertedId } = await mongoose.connection.db!.collection('expenses').insertOne({
    group: oid(groupId),
    description,
    ...money(totalMinor),
    ...(legacy ? {} : { moneyVersion: 1 }),
    currency,
    category: 'food',
    date: new Date(date),
    paidBy: Object.entries(paid).map(([user, amountMinor]) => ({
      user: oid(user),
      ...money(amountMinor),
    })),
    splitMethod: 'exact',
    splitBetween: Object.entries(shares).map(([user, amountMinor]) => ({
      user: oid(user),
      ...money(amountMinor),
    })),
    tag,
    createdBy: oid(Object.keys(paid)[0]),
    isDeleted,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
  });
  return String(insertedId);
}

interface CurrencyDaysRead {
  currency: string;
  totalMinor: number;
  dayCount: number;
  days: { day: string; shareMinor: number }[];
  expenses: { _id: string; day: string; shareMinor: number; amountMinor: number }[];
}

describe('a member', () => {
  it('gets their own share per day, the days with spending, and each Expense behind them', async () => {
    const maple = await createGroup('Maple House', [alice, bob, carol], { category: 'home' });
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    // Written in another order than added: the read lists a day's Expenses as they were added.
    const dinner = await insertExpense(
      goa,
      '2026-11-13T00:00:00.000Z',
      { [alice]: 220_000, [bob]: 220_000 },
      {
        description: 'Beach shack dinner',
        tag: 'Food',
        payers: { [alice]: 300_000, [bob]: 140_000 },
        createdAt: new Date('2026-11-13T20:00:00.000Z'),
      },
    );
    const deposit = await insertExpense(
      maple,
      '2026-11-13T00:00:00.000Z',
      { [alice]: 124_000_000, [bob]: 496_000_000 },
      {
        description: 'Flat deposit',
        tag: 'Rent',
        createdAt: new Date('2026-11-13T09:00:00.000Z'),
      },
    );
    const taxi = await insertExpense(
      goa,
      '2026-11-02T00:00:00.000Z',
      { [alice]: 64_000 },
      { description: 'Airport taxi', tag: 'Transport', payers: { [bob]: 64_000 } },
    );

    const { status, body } = await read();

    expect(status).toBe(200);
    // Android decodes exactly this reply (#1274).
    expect(parseSpendingByDayResponse(body)).toEqual(body.data);
    expect(body.data).toEqual({
      month: '2026-11',
      timeZone: 'Asia/Kolkata',
      currencies: [
        {
          currency: 'INR',
          totalMinor: 124_284_000,
          dayCount: 2,
          days: [
            { day: '2026-11-02', shareMinor: 64_000 },
            { day: '2026-11-13', shareMinor: 124_220_000 },
          ],
          expenses: [
            {
              _id: taxi,
              group: { _id: goa, name: 'Goa Friends Trip' },
              description: 'Airport taxi',
              tag: 'Transport',
              paidBy: [{ _id: bob, name: 'Bob Tester' }],
              day: '2026-11-02',
              shareMinor: 64_000,
              amountMinor: 64_000,
            },
            {
              _id: deposit,
              group: { _id: maple, name: 'Maple House' },
              description: 'Flat deposit',
              tag: 'Rent',
              paidBy: [{ _id: alice, name: 'Alice Tester' }],
              day: '2026-11-13',
              shareMinor: 124_000_000,
              amountMinor: 620_000_000,
            },
            {
              _id: dinner,
              group: { _id: goa, name: 'Goa Friends Trip' },
              description: 'Beach shack dinner',
              tag: 'Food',
              paidBy: [
                { _id: alice, name: 'Alice Tester' },
                { _id: bob, name: 'Bob Tester' },
              ],
              day: '2026-11-13',
              shareMinor: 220_000,
              amountMinor: 440_000,
            },
          ],
        },
      ],
    });
  });

  it('names a payer whose account no longer exists by id alone', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, carol]);
    await insertExpense(goa, '2026-11-05', { [alice]: 1_000 }, { payers: { [carol]: 1_000 } });
    await User.deleteOne({ _id: carol });

    const [inr] = (await read()).body.data.currencies;

    expect(inr.expenses[0].paidBy).toEqual([{ _id: carol }]);
  });

  it('sees a Month without spending as no currencies', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    await insertExpense(goa, '2026-10-05', { [alice]: 1_000 });

    const { status, body } = await read();

    expect(status).toBe(200);
    expect(body.data).toEqual({ month: '2026-11', timeZone: 'Asia/Kolkata', currencies: [] });
  });
});

describe('what counts', () => {
  it('leaves out an Expense the member has no share in, even one they paid for', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    await insertExpense(goa, '2026-11-05', { [bob]: 90_000 }, { payers: { [alice]: 90_000 } });
    await insertExpense(goa, '2026-11-06', { [alice]: 0, [bob]: 90_000 });
    const shared = await insertExpense(goa, '2026-11-07', { [alice]: 30_000, [bob]: 60_000 });

    const [inr]: CurrencyDaysRead[] = (await read()).body.data.currencies;

    expect(inr.days).toEqual([{ day: '2026-11-07', shareMinor: 30_000 }]);
    expect(inr.dayCount).toBe(1);
    expect(inr.expenses.map((expense) => expense._id)).toEqual([shared]);
  });

  it('leaves out deleted Expenses and Settlements', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    await insertExpense(goa, '2026-11-05', { [alice]: 1_200, [bob]: 1_200 });
    await insertExpense(goa, '2026-11-06', { [alice]: 50_000 }, { isDeleted: true });
    await settlementService.create(goa, { paidTo: alice, amount: 12, currency: 'INR' }, bob);

    const [inr]: CurrencyDaysRead[] = (await read()).body.data.currencies;

    expect(inr.totalMinor).toBe(1_200);
    expect(inr.days).toEqual([{ day: '2026-11-05', shareMinor: 1_200 }]);
    expect(inr.expenses).toHaveLength(1);
  });

  it('keeps currencies apart, reads legacy amounts exactly and leaves out an unsupported one', async () => {
    const lisbon = await createGroup('Lisbon Offsite', [alice, bob]);
    await insertExpense(lisbon, '2026-11-03', { [alice]: 150_000, [bob]: 150_000 });
    await insertExpense(lisbon, '2026-11-04', { [alice]: 2_000 });
    // Written before one currency per Group and before minor units.
    await insertExpense(
      lisbon,
      '2026-11-04',
      { [alice]: 1_275, [bob]: 1_275 },
      { currency: 'EUR', legacy: true },
    );
    // A currency Splitbook no longer supports has no position (#812, #820).
    await insertExpense(lisbon, '2026-11-04', { [alice]: 9_900 }, { currency: 'DEM' });

    const currencies: CurrencyDaysRead[] = (await read()).body.data.currencies;

    expect(
      currencies.map(({ currency, totalMinor, days }) => ({ currency, totalMinor, days })),
    ).toEqual([
      {
        currency: 'INR',
        totalMinor: 152_000,
        days: [
          { day: '2026-11-03', shareMinor: 150_000 },
          { day: '2026-11-04', shareMinor: 2_000 },
        ],
      },
      { currency: 'EUR', totalMinor: 1_275, days: [{ day: '2026-11-04', shareMinor: 1_275 }] },
    ]);
    expect(currencies[1].expenses[0].amountMinor).toBe(2_550);
  });

  it('counts the Month from its first day to its last, on the day each Expense is dated (#437)', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    await insertExpense(goa, '2026-10-31T00:00:00.000Z', { [alice]: 100 });
    await insertExpense(goa, '2026-11-01T00:00:00.000Z', { [alice]: 200 });
    // An older date stored at another time of day keeps its UTC day.
    await insertExpense(goa, '2026-11-30T23:30:00.000Z', { [alice]: 300 });
    await insertExpense(goa, '2026-12-01T00:00:00.000Z', { [alice]: 400 });

    for (const zone of ['Asia%2FKolkata', 'America%2FLos_Angeles', 'Pacific%2FKiritimati']) {
      const [inr]: CurrencyDaysRead[] = (await read(`month=2026-11&tz=${zone}`)).body.data
        .currencies;
      expect(inr.days).toEqual([
        { day: '2026-11-01', shareMinor: 200 },
        { day: '2026-11-30', shareMinor: 300 },
      ]);
    }
  });

  it('adds recurring Expenses that have fallen due first, as the other reads do', async () => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    const household = await createGroup('Lakeview Flat', [alice, bob, carol], {
      category: 'home',
    });
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
      startsOn: new Date('2026-10-05T00:00:00.000Z'),
      createdBy: alice,
    });

    const [inr]: CurrencyDaysRead[] = (await read()).body.data.currencies;

    expect(inr.days).toEqual([{ day: '2026-11-05', shareMinor: 100_000 }]);
    expect(await Expense.countDocuments({ group: household, period: { $ne: null } })).toBe(2);
  });

  it('gives Month totals equal to the monthly spending read', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    const lisbon = await createGroup('Lisbon Offsite', [alice, bob]);
    await insertExpense(goa, '2026-10-31T23:59:00.000Z', { [alice]: 12_345, [bob]: 1 });
    await insertExpense(goa, '2026-11-01', { [alice]: 33_334, [bob]: 66_666 });
    await insertExpense(goa, '2026-11-15T18:00:00.000Z', { [alice]: 700_000 });
    await insertExpense(goa, '2026-11-30T23:59:59.000Z', { [alice]: 1 });
    await insertExpense(lisbon, '2026-11-16', { [alice]: 8_600 }, { currency: 'EUR' });
    await insertExpense(
      lisbon,
      '2026-10-02',
      { [alice]: 1_275 },
      { currency: 'EUR', legacy: true },
    );
    await insertExpense(lisbon, '2026-11-17', { [bob]: 500 });

    const monthly = await readMonthly(
      new Request('http://localhost/api/user/spending?months=12&tz=Asia%2FKolkata'),
    );
    const { data } = await monthly.json();
    for (const month of ['2026-10', '2026-11']) {
      const fromMonthly = new Map(
        data.currencies
          .map(
            (currency: { currency: string; months: { month: string; shareMinor: number }[] }) => [
              currency.currency,
              currency.months.find((entry) => entry.month === month)!.shareMinor,
            ],
          )
          .filter(([, shareMinor]: [string, number]) => shareMinor > 0),
      );
      const days: CurrencyDaysRead[] = (await read(`month=${month}&tz=Asia%2FKolkata`)).body.data
        .currencies;
      expect(new Map(days.map((currency) => [currency.currency, currency.totalMinor]))).toEqual(
        fromMonthly,
      );
    }
    // November by hand: Alex's ₹333.34 + ₹7,000.00 + ₹0.01, and €86.00.
    const november: CurrencyDaysRead[] = (await read()).body.data.currencies;
    expect(november.map((currency) => currency.totalMinor)).toEqual([733_335, 8_600]);
  });
});

describe('only the member’s own Groups', () => {
  it('leaves out a Group they are not in, even an Expense there that names them', async () => {
    const theirs = await createGroup('Sunday Football', [bob, carol]);
    await insertExpense(theirs, '2026-11-05', { [bob]: 1_000, [alice]: 500 });

    expect((await read()).body.data.currencies).toEqual([]);
  });

  it('gives each member only their own share of a shared Group', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    await insertExpense(goa, '2026-11-05', { [alice]: 1_000, [bob]: 3_000 });

    session.userId = bob;
    const [inr]: CurrencyDaysRead[] = (await read()).body.data.currencies;
    expect(inr.days).toEqual([{ day: '2026-11-05', shareMinor: 3_000 }]);
    expect(inr.expenses[0]).toMatchObject({ shareMinor: 3_000, amountMinor: 4_000 });

    session.userId = dave;
    expect((await read()).body.data.currencies).toEqual([]);
  });

  it('leaves out a Group the member has left', async () => {
    const left = await createGroup('Old Flat', [alice, bob]);
    await insertExpense(left, '2026-11-05', { [alice]: 7_000, [bob]: 7_000 });
    // Leaving takes the member off the Group's list; their Expenses stay in its ledger.
    await Group.updateOne({ _id: left }, { $pull: { members: { user: oid(alice) } } });

    expect((await read()).body.data.currencies).toEqual([]);
  });

  it('leaves out an archived Group, as the Groups list does', async () => {
    const archived = await createGroup('Last Year', [alice, bob]);
    await insertExpense(archived, '2026-11-05', { [alice]: 7_000 });
    await Group.updateOne({ _id: archived }, { $set: { isArchived: true } });

    expect((await read()).body.data.currencies).toEqual([]);
  });
});

describe('the database work', () => {
  it('reads one Month through an index, examining none of the other Months', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    for (const date of ['2026-09-10', '2026-10-31T23:59:59.000Z', '2026-12-01', '2027-01-04'])
      await insertExpense(goa, date, { [alice]: 100 });
    for (const date of ['2026-11-01', '2026-11-15', '2026-11-30T23:00:00.000Z'])
      await insertExpense(goa, date, { [alice]: 100 });
    // In the Month but not shared by Alice: examined, never returned.
    await insertExpense(goa, '2026-11-15', { [bob]: 100 });

    const explained = await Expense.find(spendingByDayFilter(alice, [oid(goa)], '2026-11')).explain(
      'executionStats',
    );
    const plan = (Array.isArray(explained) ? explained[0] : explained) as unknown as {
      executionStats: { totalDocsExamined: number; nReturned: number };
    };

    expect(JSON.stringify(plan)).toContain('IXSCAN');
    expect(JSON.stringify(plan)).not.toContain('COLLSCAN');
    expect(plan.executionStats.totalDocsExamined).toBe(4);
    expect(plan.executionStats.nReturned).toBe(3);
  });

  it('reads nothing for a member without Groups', async () => {
    session.userId = dave;
    expect((await read()).body.data).toEqual({
      month: '2026-11',
      timeZone: 'Asia/Kolkata',
      currencies: [],
    });
  });
});

describe('requests it refuses', () => {
  it.each([
    ['no time zone', 'month=2026-11'],
    ['an empty time zone', 'month=2026-11&tz='],
    ['an unknown time zone', 'month=2026-11&tz=Mars%2FPhobos'],
    ['a fixed offset', 'month=2026-11&tz=%2B05%3A30'],
  ])('%s', async (_label, query) => {
    const { status, body } = await read(query);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'Send a named IANA time zone, such as Asia/Kolkata.',
      code: 'INVALID_TIME_ZONE',
      status: 400,
    });
  });

  it.each([
    ['no Month', 'tz=Asia%2FKolkata'],
    ['a malformed Month', 'month=2026-13&tz=Asia%2FKolkata'],
    ['a Month without its leading zero', 'month=2026-9&tz=Asia%2FKolkata'],
    ['the Month before the twelve', 'month=2025-11&tz=Asia%2FKolkata'],
    ['a Month still to come', 'month=2026-12&tz=Asia%2FKolkata'],
  ])('%s', async (_label, query) => {
    const { status, body } = await read(query);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'Ask for this Month or one of the 11 before it, written YYYY-MM.',
      code: 'INVALID_MONTH',
      status: 400,
    });
  });

  it('allows the eleventh Month back, and the next Month once the zone sent has reached it', async () => {
    expect((await read('month=2025-12&tz=Asia%2FKolkata')).status).toBe(200);
    vi.setSystemTime(new Date('2026-11-30T20:00:00.000Z'));
    expect((await read('month=2026-12&tz=Asia%2FKolkata')).status).toBe(200);
    expect((await read('month=2026-12&tz=America%2FNew_York')).status).toBe(400);
  });

  it('a signed-out request', async () => {
    session.userId = null;
    expect((await read()).status).toBe(401);
  });
});
