/**
 * Integration tests for the member's spending read (`GET /api/user/spending`, #307) against a
 * real, isolated MongoDB database (`splitbook-test-user-spending`). Only the session is a
 * stand-in, and only `Date` is faked: the read runs on 15 September 2026 at 06:00 UTC.
 *
 * It covers only the member's own Groups, adds recurring Expenses that have fallen due first
 * (while the switch, #289, is on), keeps currencies apart, buckets Months in the zone the
 * client sends and refuses an unknown one. The fields #308 adds (the current Month by Category
 * and each Group's spending, and each Group's last change) come after the others, which stay
 * exactly as they were.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { settlementService } from '@/lib/services/settlement.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
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

const db = integrationTestDb('user-spending');
const { alice, bob, carol, dave } = TEST_USER_IDS;
const NOW = new Date('2026-09-15T06:00:00.000Z');
const SIX_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

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

async function read(query = 'months=6&tz=Asia%2FKolkata') {
  const response = await GET(new Request(`http://localhost/api/user/spending?${query}`));
  return { status: response.status, body: await response.json() };
}

async function createGroup(
  name: string,
  members: string[],
  { category = 'trip', currency = 'INR' }: { category?: 'trip' | 'home'; currency?: string } = {},
) {
  const group = await groupService.create(
    { name, category, defaultCurrency: currency, alternateCurrencies: [] },
    members[0],
  );
  const groupId = String(group._id);
  for (const member of members.slice(1)) await groupService.addMember(groupId, member);
  return groupId;
}

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/**
 * A stored Expense, written as the database holds it: `shares` maps each person to their share
 * in minor units, and the first of them paid it all. A legacy Expense has no minor units.
 */
async function insertExpense(
  groupId: string,
  date: string,
  shares: Record<string, number>,
  {
    currency = 'INR',
    legacy = false,
    isDeleted = false,
    category = 'food',
  }: { currency?: string; legacy?: boolean; isDeleted?: boolean; category?: string } = {},
) {
  const people = Object.keys(shares);
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const money = (amountMinor: number) =>
    legacy ? { amount: amountMinor / 100 } : { amount: amountMinor / 100, amountMinor };
  await mongoose.connection.db!.collection('expenses').insertOne({
    group: oid(groupId),
    description: 'Synthetic expense',
    ...money(totalMinor),
    ...(legacy ? {} : { moneyVersion: 1 }),
    currency,
    category,
    date: new Date(date),
    paidBy: [{ user: oid(people[0]), ...money(totalMinor) }],
    splitMethod: 'exact',
    splitBetween: people.map((user) => ({ user: oid(user), ...money(shares[user]) })),
    tag: 'General',
    createdBy: oid(people[0]),
    isDeleted,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

interface CurrencyRead {
  currency: string;
  totalMinor: number;
  expenseCount: number;
  months: {
    month: string;
    shareMinor: number;
    byGroup: { groupId: string; shareMinor: number }[];
  }[];
}

const shares = (currency: CurrencyRead) => currency.months.map((month) => month.shareMinor);

describe('a member', () => {
  it("gets their own share per Month, exact, with each Group's part", async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    const kerala = await createGroup('Kerala Week', [alice, bob, carol]);
    // A third of ₹1,000.00 each, so the parts only add up exactly in minor units.
    await insertExpense(goa, '2026-08-10T12:00:00Z', { [alice]: 33334, [bob]: 33333 });
    await insertExpense(goa, '2026-08-11T12:00:00Z', { [bob]: 33333, [alice]: 33333 });
    await insertExpense(kerala, '2026-08-20T12:00:00Z', { [carol]: 90000, [alice]: 30000 });
    await insertExpense(kerala, '2026-09-02T12:00:00Z', { [alice]: 1 });
    // Not Alice's: she isn't in the split.
    await insertExpense(kerala, '2026-09-03T12:00:00Z', { [bob]: 50000, [carol]: 50000 });
    // Deleted.
    await insertExpense(goa, '2026-09-04T12:00:00Z', { [alice]: 99999 }, { isDeleted: true });

    const { status, body } = await read();

    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      timeZone: 'Asia/Kolkata',
      months: SIX_MONTHS,
      window: { from: '2026-04-01', to: '2026-09-30' },
    });
    expect(body.data.groups).toEqual([
      { groupId: goa, name: 'Goa Friends Trip' },
      { groupId: kerala, name: 'Kerala Week' },
    ]);
    const [inr]: CurrencyRead[] = body.data.currencies;
    expect(body.data.currencies).toHaveLength(1);
    expect(inr).toMatchObject({ currency: 'INR', totalMinor: 96668, expenseCount: 4 });
    expect(shares(inr)).toEqual([0, 0, 0, 0, 96667, 1]);
    expect(inr.months[4].byGroup).toEqual([
      { groupId: goa, shareMinor: 66667 },
      { groupId: kerala, shareMinor: 30000 },
    ]);
    expect(inr.months[5].byGroup).toEqual([{ groupId: kerala, shareMinor: 1 }]);
  });

  it('buckets Months in the zone sent, never the server’s', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    // 20:00 UTC on 31 August: 1 September in Kolkata, still 31 August in New York.
    await insertExpense(goa, '2026-08-31T20:00:00Z', { [alice]: 4200 });

    const kolkata = (await read('months=2&tz=Asia%2FKolkata')).body.data;
    const newYork = (await read('months=2&tz=America%2FNew_York')).body.data;

    expect(kolkata.months).toEqual(['2026-08', '2026-09']);
    expect(shares(kolkata.currencies[0])).toEqual([0, 4200]);
    expect(newYork.months).toEqual(['2026-08', '2026-09']);
    expect(shares(newYork.currencies[0])).toEqual([4200, 0]);
  });

  it('ends the window with the current Month in the zone sent', async () => {
    vi.setSystemTime(new Date('2026-09-30T20:00:00.000Z'));
    await createGroup('Goa Friends Trip', [alice, bob]);

    expect((await read('months=3&tz=Asia%2FKolkata')).body.data.months).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect((await read('months=3&tz=UTC')).body.data.months).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('sees "no spending yet" as no currencies, with every Group still listed', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body.data.currencies).toEqual([]);
    expect(body.data.groups).toEqual([{ groupId: goa, name: 'Goa Friends Trip' }]);
  });
});

describe('only the member’s own Groups', () => {
  it('leaves out a Group they are not in, even an Expense there that names them', async () => {
    const theirs = await createGroup('Sunday Football', [bob, carol]);
    await insertExpense(theirs, '2026-09-05T12:00:00Z', { [bob]: 1000, [alice]: 500 });

    const { body } = await read();

    expect(body.data.groups).toEqual([]);
    expect(body.data.currencies).toEqual([]);
  });

  it('gives each member only their own share of a shared Group', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    await insertExpense(goa, '2026-09-05T12:00:00Z', { [alice]: 1000, [bob]: 3000 });

    session.userId = bob;
    const { body } = await read();
    expect(shares(body.data.currencies[0])).toEqual([0, 0, 0, 0, 0, 3000]);

    session.userId = dave;
    expect((await read()).body.data).toMatchObject({ groups: [], currencies: [] });
  });

  it('leaves out a Group the member has left', async () => {
    const left = await createGroup('Old Flat', [alice, bob]);
    const stayed = await createGroup('Goa Friends Trip', [alice, bob]);
    await insertExpense(left, '2026-08-05T12:00:00Z', { [alice]: 7000, [bob]: 7000 });
    await insertExpense(stayed, '2026-08-06T12:00:00Z', { [alice]: 100 });
    // Leaving takes the member off the Group's list; their Expenses stay in its ledger.
    await Group.updateOne({ _id: left }, { $pull: { members: { user: oid(alice) } } });

    const { body } = await read();

    expect(body.data.groups).toEqual([{ groupId: stayed, name: 'Goa Friends Trip' }]);
    expect(body.data.currencies[0].months[4].byGroup).toEqual([
      { groupId: stayed, shareMinor: 100 },
    ]);
  });

  it('leaves out an archived Group, as the Groups list does', async () => {
    const archived = await createGroup('Last Year', [alice, bob]);
    await insertExpense(archived, '2026-08-05T12:00:00Z', { [alice]: 7000 });
    await Group.updateOne({ _id: archived }, { $set: { isArchived: true } });

    expect((await read()).body.data).toMatchObject({ groups: [], currencies: [] });
  });
});

describe('a legacy Group with Expenses in two currencies', () => {
  it('keeps each currency apart and reads legacy amounts exactly', async () => {
    const lisbon = await createGroup('Lisbon Offsite', [alice, bob]);
    await insertExpense(lisbon, '2026-08-05T12:00:00Z', { [alice]: 150000, [bob]: 150000 });
    // Written before one currency per Group and before minor units.
    await insertExpense(
      lisbon,
      '2026-08-06T12:00:00Z',
      { [bob]: 1275, [alice]: 1275 },
      { currency: 'EUR', legacy: true },
    );
    await insertExpense(
      lisbon,
      '2026-09-06T12:00:00Z',
      { [alice]: 1001, [bob]: 999 },
      { currency: 'EUR', legacy: true },
    );

    const { status, body } = await read();

    expect(status).toBe(200);
    const currencies: CurrencyRead[] = body.data.currencies;
    expect(currencies.map((currency) => currency.currency)).toEqual(['EUR', 'INR']);
    const [eur, inr] = currencies;
    expect(eur).toMatchObject({ totalMinor: 2276, expenseCount: 2 });
    expect(shares(eur)).toEqual([0, 0, 0, 0, 1275, 1001]);
    expect(inr).toMatchObject({ totalMinor: 150000, expenseCount: 1 });
    expect(eur.months[4].byGroup).toEqual([{ groupId: lisbon, shareMinor: 1275 }]);
    expect(inr.months[4].byGroup).toEqual([{ groupId: lisbon, shareMinor: 150000 }]);
  });
});

describe('recurring Expenses that have fallen due', () => {
  /** A Household whose Rent template started in July, with nothing generated yet. */
  async function householdWithRent() {
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
      startsOn: new Date('2026-07-05T00:00:00.000Z'),
      createdBy: alice,
    });
    return household;
  }

  it('adds them before totalling while the switch is on, as the Group reads do', async () => {
    switchRecurringExpenses(true);
    const household = await householdWithRent();

    const { status, body } = await read();

    expect(status).toBe(200);
    const [inr]: CurrencyRead[] = body.data.currencies;
    expect(shares(inr)).toEqual([0, 0, 0, 100000, 100000, 100000]);
    expect(inr.months[5].byGroup).toEqual([{ groupId: household, shareMinor: 100000 }]);
    expect(await Expense.countDocuments({ group: household, period: { $ne: null } })).toBe(3);
  });

  it('adds none while the switch is off, and changes nothing stored', async () => {
    switchRecurringExpenses(false);
    const household = await householdWithRent();

    const { status, body } = await read();

    expect(status).toBe(200);
    expect(body.data.currencies).toEqual([]);
    expect(await Expense.countDocuments({ group: household })).toBe(0);
    expect(await RecurringExpense.findOne({ group: household }).lean()).toMatchObject({
      lastGeneratedFor: null,
    });
  });

  it("counts this Month's in the Category totals and the Group's spending while the switch is on", async () => {
    switchRecurringExpenses(true);
    const household = await householdWithRent();

    const { body } = await read();

    expect(body.data.thisMonth).toEqual({
      month: '2026-09',
      byCategory: [
        {
          currency: 'INR',
          totalMinor: 100000,
          expenseCount: 1,
          categories: [{ category: 'housing', shareMinor: 100000, expenseCount: 1 }],
        },
      ],
      groups: [
        {
          groupId: household,
          spent: [{ currency: 'INR', totalMinor: 300000, expenseCount: 1 }],
        },
      ],
    });
  });

  it('counts none of them while the switch is off: nothing spent, no Category', async () => {
    switchRecurringExpenses(false);
    const household = await householdWithRent();

    const { body } = await read();

    expect(body.data.thisMonth).toEqual({
      month: '2026-09',
      byCategory: [],
      groups: [{ groupId: household, spent: [] }],
    });
  });
});

describe('this Month in detail (#308)', () => {
  it("gives the member's share by Category across Groups, and what each Group spent", async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob, carol]);
    const kerala = await createGroup('Kerala Week', [alice, bob]);
    const quiet = await createGroup('Quiet Flat', [alice, bob]);
    // Food in two Groups counts as one Category; Tags are never merged across Groups.
    await insertExpense(goa, '2026-09-02T12:00:00Z', { [alice]: 33334, [bob]: 33333 });
    await insertExpense(kerala, '2026-09-03T12:00:00Z', { [alice]: 12000, [bob]: 12000 });
    await insertExpense(
      goa,
      '2026-09-04T12:00:00Z',
      { [alice]: 250000, [carol]: 250000 },
      { category: 'accommodation' },
    );
    // Not Alice's: it counts toward Goa's spending only.
    await insertExpense(
      goa,
      '2026-09-05T12:00:00Z',
      { [bob]: 4500, [carol]: 4500 },
      { category: 'transport' },
    );
    // Stored before Categories were checked: counted as Other.
    await insertExpense(kerala, '2026-09-06T12:00:00Z', { [alice]: 100 }, { category: 'Snacks' });
    // Last Month, and deleted: neither is this Month's.
    await insertExpense(goa, '2026-08-20T12:00:00Z', { [alice]: 70000 });
    await insertExpense(kerala, '2026-09-07T12:00:00Z', { [alice]: 999 }, { isDeleted: true });

    const { status, body } = await read();

    expect(status).toBe(200);
    expect(body.data.thisMonth).toEqual({
      month: '2026-09',
      byCategory: [
        {
          currency: 'INR',
          totalMinor: 295434,
          expenseCount: 4,
          categories: [
            { category: 'accommodation', shareMinor: 250000, expenseCount: 1 },
            { category: 'food', shareMinor: 45334, expenseCount: 2 },
            { category: 'other', shareMinor: 100, expenseCount: 1 },
          ],
        },
      ],
      // In the Groups' order, every one listed.
      groups: [
        { groupId: goa, spent: [{ currency: 'INR', totalMinor: 575667, expenseCount: 3 }] },
        { groupId: kerala, spent: [{ currency: 'INR', totalMinor: 24100, expenseCount: 2 }] },
        { groupId: quiet, spent: [] },
      ],
    });
  });

  it('keeps currencies apart in a legacy Group, never converting them', async () => {
    const lisbon = await createGroup('Lisbon Offsite', [alice, bob]);
    await insertExpense(lisbon, '2026-09-05T12:00:00Z', { [alice]: 150000, [bob]: 150000 });
    await insertExpense(
      lisbon,
      '2026-09-06T12:00:00Z',
      { [bob]: 1275, [alice]: 1275 },
      { currency: 'EUR', legacy: true, category: 'travel' },
    );

    const { body } = await read();

    expect(body.data.thisMonth.byCategory).toEqual([
      {
        currency: 'EUR',
        totalMinor: 1275,
        expenseCount: 1,
        categories: [{ category: 'travel', shareMinor: 1275, expenseCount: 1 }],
      },
      {
        currency: 'INR',
        totalMinor: 150000,
        expenseCount: 1,
        categories: [{ category: 'food', shareMinor: 150000, expenseCount: 1 }],
      },
    ]);
    expect(body.data.thisMonth.groups).toEqual([
      {
        groupId: lisbon,
        spent: [
          { currency: 'EUR', totalMinor: 2550, expenseCount: 1 },
          { currency: 'INR', totalMinor: 300000, expenseCount: 1 },
        ],
      },
    ]);
  });

  it('is the Month of the zone sent', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    // 20:00 UTC on 31 August: 1 September in Kolkata, still 31 August in New York.
    await insertExpense(goa, '2026-08-31T20:00:00Z', { [alice]: 4200 });

    const kolkata = (await read('months=2&tz=Asia%2FKolkata')).body.data.thisMonth;
    const newYork = (await read('months=2&tz=America%2FNew_York')).body.data.thisMonth;

    expect(kolkata.groups[0].spent).toEqual([
      { currency: 'INR', totalMinor: 4200, expenseCount: 1 },
    ]);
    expect(newYork).toEqual({
      month: '2026-09',
      byCategory: [],
      groups: [{ groupId: goa, spent: [] }],
    });
  });

  it('covers only the member’s own Groups', async () => {
    const theirs = await createGroup('Sunday Football', [bob, carol]);
    await insertExpense(theirs, '2026-09-05T12:00:00Z', { [bob]: 1000, [alice]: 500 });

    const { body } = await read();

    expect(body.data.thisMonth).toEqual({ month: '2026-09', byCategory: [], groups: [] });
    expect(body.data.lastChanges).toEqual([]);
  });
});

describe('the fields the spending chart reads', () => {
  it('stay exactly as before #308, with the additions after them', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob, carol]);
    const kerala = await createGroup('Kerala Week', [alice, bob]);
    await insertExpense(goa, '2026-08-10T12:00:00Z', { [alice]: 33334, [bob]: 33333 });
    await insertExpense(kerala, '2026-09-02T12:00:00Z', { [carol]: 1, [alice]: 2 });
    // This Month's Expenses Alice doesn't share are now read for the Groups' spending; they
    // must not reach her figures.
    await insertExpense(goa, '2026-09-03T12:00:00Z', { [bob]: 50000, [carol]: 50000 });
    await insertExpense(kerala, '2026-09-04T12:00:00Z', { [bob]: 1200 }, { category: 'transport' });
    await insertExpense(goa, '2026-09-05T12:00:00Z', { [bob]: 700 }, { currency: 'EUR' });

    const { body } = await read();

    expect(Object.keys(body.data)).toEqual([
      'timeZone',
      'months',
      'window',
      'groups',
      'currencies',
      'thisMonth',
      'lastChanges',
    ]);
    const { timeZone, months, window, groups, currencies } = body.data;
    const month = (shareMinor: number, byGroup: { groupId: string; shareMinor: number }[]) => ({
      shareMinor,
      byGroup,
    });
    expect(JSON.stringify({ timeZone, months, window, groups, currencies })).toBe(
      JSON.stringify({
        timeZone: 'Asia/Kolkata',
        months: SIX_MONTHS,
        window: { from: '2026-04-01', to: '2026-09-30' },
        groups: [
          { groupId: goa, name: 'Goa Friends Trip' },
          { groupId: kerala, name: 'Kerala Week' },
        ],
        currencies: [
          {
            currency: 'INR',
            totalMinor: 33336,
            expenseCount: 2,
            months: [
              { month: '2026-04', ...month(0, []) },
              { month: '2026-05', ...month(0, []) },
              { month: '2026-06', ...month(0, []) },
              { month: '2026-07', ...month(0, []) },
              { month: '2026-08', ...month(33334, [{ groupId: goa, shareMinor: 33334 }]) },
              { month: '2026-09', ...month(2, [{ groupId: kerala, shareMinor: 2 }]) },
            ],
          },
        ],
      }),
    );
  });
});

describe("each Group's last change (#308)", () => {
  const lastChange = async (groupId: string) =>
    (await read()).body.data.lastChanges.find(
      (entry: { groupId: string }) => entry.groupId === groupId,
    ).at;

  it('moves with an Expense, a Settlement and an edit to the Group, and only in that Group', async () => {
    vi.setSystemTime(new Date('2026-09-10T08:00:00.000Z'));
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    const quiet = await createGroup('Quiet Flat', [alice, bob]);
    // Created and joined: the Group's own Activity.
    expect(await lastChange(goa)).toBe('2026-09-10T08:00:00.000Z');

    vi.setSystemTime(new Date('2026-09-11T09:30:00.000Z'));
    await expenseService.create(
      goa,
      {
        description: 'Beach shack dinner',
        amount: 2400,
        currency: 'INR',
        category: 'food',
        date: new Date('2026-09-11T09:30:00.000Z'),
        splitMethod: 'equal',
        tag: 'Food',
        paidBy: [{ user: alice, amount: 2400 }],
        splitBetween: [{ user: alice }, { user: bob }],
      },
      alice,
    );
    expect(await lastChange(goa)).toBe('2026-09-11T09:30:00.000Z');

    vi.setSystemTime(new Date('2026-09-12T18:45:00.000Z'));
    await settlementService.create(goa, { paidTo: alice, amount: 1200, currency: 'INR' }, bob);
    expect(await lastChange(goa)).toBe('2026-09-12T18:45:00.000Z');

    vi.setSystemTime(new Date('2026-09-14T07:15:00.000Z'));
    await groupService.update(goa, { name: 'Goa Friends Trip 2026' }, alice);
    expect(await lastChange(goa)).toBe('2026-09-14T07:15:00.000Z');

    // The other Group never changed.
    expect(await lastChange(quiet)).toBe('2026-09-10T08:00:00.000Z');
  });

  it('lists every Group in the Groups’ order, null for one without any Activity', async () => {
    const goa = await createGroup('Goa Friends Trip', [alice, bob]);
    const legacy = await createGroup('Kerala Week', [alice, bob]);
    // A Group from before Activity was recorded.
    await Activity.deleteMany({ group: legacy });

    const { body } = await read();

    expect(body.data.lastChanges).toEqual([
      { groupId: goa, at: NOW.toISOString() },
      { groupId: legacy, at: null },
    ]);
  });

  it('leaves out a Group the member has left', async () => {
    const left = await createGroup('Old Flat', [alice, bob]);
    const stayed = await createGroup('Goa Friends Trip', [alice, bob]);
    await Group.updateOne({ _id: left }, { $pull: { members: { user: oid(alice) } } });

    const { body } = await read();

    expect(body.data.lastChanges.map((entry: { groupId: string }) => entry.groupId)).toEqual([
      stayed,
    ]);
  });
});

describe('requests it refuses', () => {
  it.each([
    ['no time zone', 'months=6'],
    ['an empty time zone', 'months=6&tz='],
    ['an unknown time zone', 'months=6&tz=Mars%2FPhobos'],
    ['a fixed offset', 'months=6&tz=%2B05%3A30'],
  ])('%s', async (_label, query) => {
    const { status, body } = await read(query);
    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'Send a named IANA time zone, such as Asia/Kolkata.',
      code: 'INVALID_TIME_ZONE',
      status: 400,
    });
  });

  it.each(['0', '13', 'six', '2.5'])('a Month count of %s', async (months) => {
    const { status, body } = await read(`months=${months}&tz=Asia%2FKolkata`);
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'INVALID_MONTHS' });
  });

  it('defaults to six Months', async () => {
    expect((await read('tz=Asia%2FKolkata')).body.data.months).toEqual(SIX_MONTHS);
  });

  it('a signed-out request', async () => {
    session.userId = null;
    expect((await read()).status).toBe(401);
  });
});
