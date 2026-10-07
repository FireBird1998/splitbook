/**
 * Integration tests for the Expense list read (`GET /api/groups/[id]/expenses`) against a real,
 * isolated MongoDB database (`splitbook-test-expense-list-route`). Only the session is a
 * stand-in; membership, recurring generation, the filters and the summary run for real.
 *
 * #310 added an "involves me" filter, an amount range, a cap on the page size and, on request,
 * a count of the Expenses recurring Expenses added. Android reads this route, so every request
 * it could already make must answer exactly as before: `list-before-310.golden.json` holds
 * those answers as `main` gave them before #310 (2c37639), and they are compared as text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { expensePagePath } from '@splitbook/shared/api-paths';
import { parseExpensePageResponse } from '@splitbook/shared/expense-page-read';
import { expenseDateForPeriod, toPeriod } from '@splitbook/shared/recurring-due-periods';
import type { ExpenseFilters } from '@splitbook/shared/types';
import { GET as readExpenses } from './route';

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

const db = integrationTestDb('expense-list-route');
const { alice, bob, carol, dave } = TEST_USER_IDS;

/** Recurring Expenses are off unless the variable is exactly `true`; unset is the default. */
function switchRecurringExpenses(on: boolean) {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', on ? 'true' : undefined);
}

beforeAll(async () => {
  await db.connect();
  await Expense.createIndexes();
});
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = alice;
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(db.teardown);

interface Fixture {
  groupId: string;
  /** Every stored id, by the label the golden answers use in its place. */
  labels: Map<string, string>;
  tagIds: Record<string, string>;
  expenseIds: Record<string, string>;
}

/**
 * A Household of three with five Expenses in September and August 2026: each payer, an equal
 * split, an exact split that leaves Alice out, and one where Alice's share is a zero row.
 */
async function household(): Promise<Fixture> {
  const group = await groupService.create(
    {
      name: 'Synthetic Lakeview Flat',
      category: 'home',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  await groupService.addMember(groupId, carol);

  const add = (
    description: string,
    amount: number,
    date: string,
    tag: string,
    paidBy: string,
    splitBetween: Array<{ user: string; amount?: number }>,
    category = 'other',
  ) =>
    expenseService.create(
      groupId,
      {
        description,
        amount,
        currency: 'INR',
        category,
        date: new Date(date),
        paidBy: [{ user: paidBy, amount }],
        splitMethod: splitBetween.some((row) => row.amount !== undefined) ? 'exact' : 'equal',
        splitBetween,
        tag,
      },
      paidBy,
    );

  const everyone = [{ user: alice }, { user: bob }, { user: carol }];
  const created = [
    await add('Weekly groceries', 1249.5, '2026-09-30T06:00:00.000Z', 'Groceries', alice, everyone),
    await add(
      'Electricity bill',
      2860,
      '2026-09-29T06:00:00.000Z',
      'Utilities',
      bob,
      everyone,
      'housing',
    ),
    await add('Takeaway pizza', 1180, '2026-09-19T06:00:00.000Z', 'General', carol, [
      { user: bob, amount: 590 },
      { user: carol, amount: 590 },
    ]),
    await add('Plumber', 1080, '2026-08-12T06:00:00.000Z', 'Household', bob, [
      { user: alice, amount: 540 },
      { user: bob, amount: 540 },
    ]),
    await add('Water cans', 320, '2026-08-03T06:00:00.000Z', 'Household', carol, [
      { user: bob, amount: 160 },
      { user: carol, amount: 160 },
    ]),
  ];
  // Alice stays in the Water cans split with a share of nothing, as a split by shares can
  // leave someone: she is named in it but not part of it.
  const waterCans = created[4]!;
  await Expense.updateOne(
    { _id: waterCans._id },
    {
      $push: {
        splitBetween: { user: new mongoose.Types.ObjectId(alice), amount: 0, amountMinor: 0 },
      },
    },
  );

  const stored = await groupService.getById(groupId);
  const tagIds = Object.fromEntries(
    (stored?.tags ?? []).map((tag: { _id: unknown; name: string }) => [tag.name, String(tag._id)]),
  );
  const expenseIds = Object.fromEntries(
    created.map((expense) => [expense!.description, String(expense!._id)]),
  );
  const labels = new Map<string, string>([[groupId, '<group>']]);
  for (const [name, id] of Object.entries(tagIds)) labels.set(id, `<tag:${name}>`);
  for (const [name, id] of Object.entries(expenseIds)) labels.set(id, `<expense:${name}>`);
  return { groupId, labels, tagIds, expenseIds };
}

async function read(groupId: string, query: string) {
  const response = await readExpenses(
    new Request(`http://localhost/api/groups/${groupId}/expenses${query}`),
    { params: Promise.resolve({ id: groupId }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A read built the way the apps build it, through the shared path builder. */
async function list(groupId: string, filters: ExpenseFilters) {
  const path = expensePagePath(groupId, filters);
  return read(groupId, path.slice(path.indexOf('/expenses') + '/expenses'.length));
}

const descriptions = (body: { data: { expenses: Array<{ description: string }> } }) =>
  body.data.expenses.map((expense) => expense.description);

/**
 * The body as text, with what changes from run to run (ids, and the time each row was saved)
 * replaced by labels. Key order is kept: the golden answers are compared byte for byte.
 */
function normalized(body: unknown, labels: Map<string, string>): string {
  return JSON.stringify(body, (key, value) =>
    key === 'createdAt' || key === 'updatedAt'
      ? '<time>'
      : typeof value === 'string' && labels.has(value)
        ? labels.get(value)
        : value,
  );
}

/**
 * Requests Android and the web made before #310, as Alice, Bob and Carol, each with the name
 * of its recorded answer. No query, and a page size of 0, answered as Android's first page;
 * a page of 100 did too, with its own size.
 */
function existingRequests(
  fixture: Fixture,
): Array<[answer: string, user: string, query: string, limit?: number]> {
  return [
    ['android-first-page', alice, '?page=1&limit=20'],
    [
      'android-household-month',
      alice,
      '?page=1&limit=20&includeMemberBreakdown=1' +
        '&dateFrom=2026-08-31T18%3A30%3A00.000Z&dateTo=2026-09-30T18%3A29%3A59.999Z',
    ],
    ['web-header-count', bob, '?page=1&limit=1'],
    [
      'web-filtered',
      alice,
      `?search=water&tagId=${fixture.tagIds.Household}&sortBy=amount&sortOrder=asc&page=1&limit=20`,
    ],
    [
      'web-paid-and-owed',
      bob,
      `?paidByUser=${bob}&owedByUser=${alice}&sortBy=date&sortOrder=desc&page=1&limit=20`,
    ],
    ['web-second-page', carol, '?page=2&limit=2&category=other'],
    ['android-first-page', alice, ''],
    ['android-first-page', alice, '?limit=0'],
    ['android-first-page', alice, '?limit=100', 100],
  ];
}

describe('requests made before #310', () => {
  it('answer byte for byte as they did before, with no summary field added', async () => {
    const golden = JSON.parse(
      readFileSync(join(__dirname, 'list-before-310.golden.json'), 'utf8'),
    ) as Record<string, unknown>;
    const fixture = await household();
    const requests = existingRequests(fixture);
    expect(new Set(requests.map(([answer]) => answer))).toEqual(new Set(Object.keys(golden)));
    for (const [answer, user, query, limit] of requests) {
      session.userId = user;
      const { status, body } = await read(fixture.groupId, query);
      expect(status, query).toBe(200);
      const expected = JSON.stringify(golden[answer]);
      expect(normalized(body, fixture.labels), query).toBe(
        limit === undefined ? expected : expected.replace('"limit":20', `"limit":${limit}`),
      );
    }
  });

  it('answer the same with recurring Expenses switched on, and still send no recurring count', async () => {
    switchRecurringExpenses(true);
    const fixture = await household();
    const { body } = await read(fixture.groupId, '?page=1&limit=20');
    expect(Object.keys(body.data.summary)).toEqual([
      'totalAmount',
      'totalsByCurrency',
      'count',
      'userOwes',
      'userGetsBack',
    ]);
  });
});

describe('involves me', () => {
  it('keeps the Expenses the member paid part of or has a share of', async () => {
    const fixture = await household();
    const { status, body } = await list(fixture.groupId, { involvesUser: alice });
    expect(status).toBe(200);
    // Not the pizza (Bob and Carol), nor the water cans, where Alice's share is nothing.
    expect(descriptions(body)).toEqual(['Weekly groceries', 'Electricity bill', 'Plumber']);
    expect(body.data.summary).toMatchObject({ count: 3, totalAmount: 5189.5 });
    expect(body.data.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
  });

  it('works for any member, with the other filters, and as the shared decoder reads it', async () => {
    const fixture = await household();
    const { body } = await list(fixture.groupId, {
      involvesUser: carol,
      tagId: fixture.tagIds.Household,
      sortBy: 'amount',
      sortOrder: 'asc',
    });
    expect(parseExpensePageResponse(body).expenses.map((row) => row.description)).toEqual([
      'Water cans',
    ]);

    session.userId = bob;
    const everything = await list(fixture.groupId, { involvesUser: bob });
    expect(descriptions(everything.body)).toHaveLength(5);
  });

  it('matches nothing for someone outside the Group', async () => {
    const fixture = await household();
    const { status, body } = await list(fixture.groupId, { involvesUser: dave });
    expect(status).toBe(200);
    expect(body.data.expenses).toEqual([]);
    expect(body.data.summary.count).toBe(0);
  });

  it('refuses an id that is not one', async () => {
    const fixture = await household();
    for (const id of ['me', 'b0000000000000000000000', 'b00000000000000000000001x']) {
      const { status, body } = await read(fixture.groupId, `?involvesUser=${id}`);
      expect(status, id).toBe(422);
      expect(body.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('the amount range', () => {
  it('is inclusive at both ends, and exact to the paisa', async () => {
    const fixture = await household();
    const range = async (amountMin?: string, amountMax?: string) =>
      descriptions((await list(fixture.groupId, { amountMin, amountMax })).body);

    expect(await range('1080', '1249.50')).toEqual([
      'Weekly groceries',
      'Takeaway pizza',
      'Plumber',
    ]);
    expect(await range('1249.51')).toEqual(['Electricity bill']);
    expect(await range(undefined, '1079.99')).toEqual(['Water cans']);
    expect(await range('320', '320')).toEqual(['Water cans']);
    expect(await range('0', '0.5')).toEqual([]);
  });

  it('totals only the Expenses in the range', async () => {
    const fixture = await household();
    const { body } = await list(fixture.groupId, {
      amountMin: '1000',
      amountMax: '2000',
      includeMemberBreakdown: true,
    });
    expect(body.data.summary).toMatchObject({ count: 3, totalAmount: 3509.5 });
  });

  it('still finds an older Expense whose stored amount has a binary tail', async () => {
    const fixture = await household();
    await Expense.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(fixture.expenseIds['Water cans']) },
      {
        $set: {
          amount: 0.30000000000000004,
          'paidBy.0.amount': 0.30000000000000004,
          'splitBetween.0.amount': 0.15,
          'splitBetween.1.amount': 0.15000000000000002,
        },
        $unset: {
          amountMinor: '',
          moneyVersion: '',
          'paidBy.0.amountMinor': '',
          'splitBetween.0.amountMinor': '',
          'splitBetween.1.amountMinor': '',
          'splitBetween.2.amountMinor': '',
        },
      },
    );
    const exact = await list(fixture.groupId, { amountMin: '0.30', amountMax: '0.30' });
    expect(descriptions(exact.body)).toEqual(['Water cans']);
    const below = await list(fixture.groupId, { amountMax: '0.29' });
    expect(descriptions(below.body)).toEqual([]);
  });

  it('refuses text that is not a plain amount, more decimals than the currency has, and a range the wrong way round', async () => {
    const fixture = await household();
    for (const query of ['?amountMin=-5', '?amountMax=1e3', '?amountMin=ten', '?amountMin=1.']) {
      const { status, body } = await read(fixture.groupId, query);
      expect(status, query).toBe(422);
      expect(body.code, query).toBe('VALIDATION_ERROR');
    }
    const precise = await read(fixture.groupId, '?amountMin=10.005');
    expect(precise.status).toBe(422);
    expect(precise.body.code).toBe('INVALID_MONEY_PRECISION');
    const reversed = await read(fixture.groupId, '?amountMin=500&amountMax=100');
    expect(reversed.status).toBe(422);
    expect(reversed.body.code).toBe('INVALID_AMOUNT_RANGE');
  });
});

describe('the page size', () => {
  it('cuts a page larger than 100 Expenses to 100', async () => {
    const fixture = await household();
    const docs = Array.from({ length: 101 }, (_, index) => ({
      group: new mongoose.Types.ObjectId(fixture.groupId),
      description: `Bulk ${index}`,
      amount: 10,
      amountMinor: 1000,
      moneyVersion: 1,
      currency: 'INR',
      category: 'other',
      date: new Date('2026-07-01T06:00:00.000Z'),
      paidBy: [{ user: new mongoose.Types.ObjectId(alice), amount: 10, amountMinor: 1000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: new mongoose.Types.ObjectId(alice), amount: 10, amountMinor: 1000 }],
      tag: 'General',
      tagId: new mongoose.Types.ObjectId(fixture.tagIds.General),
      createdBy: new mongoose.Types.ObjectId(alice),
      isDeleted: false,
    }));
    await Expense.collection.insertMany(docs);

    for (const limit of ['101', '500', '9007199254740993']) {
      const { status, body } = await read(fixture.groupId, `?limit=${limit}`);
      expect(status, limit).toBe(200);
      expect(body.data.expenses, limit).toHaveLength(100);
      expect(body.data.pagination, limit).toEqual({
        page: 1,
        limit: 100,
        total: 106,
        totalPages: 2,
      });
    }
    const second = await read(fixture.groupId, '?limit=500&page=2');
    expect(second.body.data.expenses).toHaveLength(6);
  });

  it('reads a page size that is not a positive whole number as the default of 20', async () => {
    const fixture = await household();
    for (const limit of ['0', '-5', 'many']) {
      const { status, body } = await read(fixture.groupId, `?limit=${limit}`);
      expect(status, limit).toBe(200);
      expect(body.data.pagination.limit, limit).toBe(20);
    }
  });
});

describe('the count of Expenses recurring Expenses added', () => {
  const CURRENT_PERIOD = toPeriod(new Date());

  /** The fixture, plus a Rent template that has added this month's Rent. */
  async function householdWithRent() {
    switchRecurringExpenses(true);
    const fixture = await household();
    await recurringExpenseService.create(
      fixture.groupId,
      {
        description: 'Rent',
        amount: 30000,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: alice, amount: 30000 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
        dayOfMonth: 1,
        startsOn: expenseDateForPeriod(CURRENT_PERIOD, 1),
      },
      alice,
    );
    return fixture;
  }

  it('is in the summary on request while recurring Expenses are on, for the filtered Expenses', async () => {
    const fixture = await householdWithRent();
    const all = await list(fixture.groupId, { includeRecurringCount: true });
    expect(all.status).toBe(200);
    expect(all.body.data.summary).toMatchObject({ count: 6, recurringCount: 1 });
    expect(parseExpensePageResponse(all.body).summary.recurringCount).toBe(1);
    const rent = all.body.data.expenses.find(
      (expense: { description: string }) => expense.description === 'Rent',
    );
    expect(rent.recurringExpense).toMatch(/^[a-f\d]{24}$/);

    const notRent = await list(fixture.groupId, {
      includeRecurringCount: true,
      amountMax: '5000',
    });
    expect(notRent.body.data.summary).toMatchObject({ count: 5, recurringCount: 0 });
  });

  it('is left out unless asked for', async () => {
    const fixture = await householdWithRent();
    const { body } = await list(fixture.groupId, { includeMemberBreakdown: true });
    expect(body.data.summary).not.toHaveProperty('recurringCount');
    const other = await read(fixture.groupId, '?includeRecurringCount=true');
    expect(other.body.data.summary).not.toHaveProperty('recurringCount');
  });

  it('is left out while recurring Expenses are off, even when asked for', async () => {
    const fixture = await householdWithRent();
    switchRecurringExpenses(false);
    const { status, body } = await list(fixture.groupId, { includeRecurringCount: true });
    expect(status).toBe(200);
    // The Rent added while the switch was on stays an ordinary Expense in the list.
    expect(body.data.summary.count).toBe(6);
    expect(body.data.summary).not.toHaveProperty('recurringCount');
  });
});

describe('who may read', () => {
  it('refuses someone outside the Group, and a signed-out caller, before any filter is read', async () => {
    const fixture = await household();
    session.userId = dave;
    expect((await read(fixture.groupId, `?involvesUser=${dave}&amountMin=1`)).status).toBe(403);
    expect((await read(fixture.groupId, '?amountMin=bad')).status).toBe(403);
    session.userId = null;
    expect((await read(fixture.groupId, '?limit=500')).status).toBe(401);
  });

  it('refuses a member who has left', async () => {
    const fixture = await household();
    await groupService.removeMember(fixture.groupId, carol, alice);
    session.userId = carol;
    expect((await read(fixture.groupId, `?involvesUser=${carol}`)).status).toBe(403);
  });
});
