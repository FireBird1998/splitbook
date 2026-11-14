import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { integrationTestDb } from './test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from './test-utils/signed-in-route';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { groupService } from './services/group.service';
import { expenseService } from './services/expense.service';
import { parseRecentLedgerRead } from '@splitbook/shared/recent-ledger-read';
import { settlementService } from './services/settlement.service';
import mongoose from 'mongoose';
import Expense from './models/Expense';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const db = integrationTestDb('widget-recent');
const { alex, sam } = DEMO_PERSONA_IDS;
let GET: typeof import('../app/api/groups/[id]/expenses/route').GET;
let cookie: string, groupId: string;
beforeAll(async () => {
  await connectSignedIn(db);
  ({ GET } = await import('../app/api/groups/[id]/expenses/route'));
});
afterAll(() => disconnectSignedIn(db));
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  cookie = await signIn('alex');
  const group = await groupService.create(
    { name: 'Recent test Trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  groupId = String(group._id);
  await groupService.addMember(groupId, sam);
});
const addExpense = (description: string, date = '2026-11-01') =>
  expenseService.create(
    groupId,
    {
      description,
      amount: 90,
      currency: 'INR',
      category: 'other',
      tag: 'General',
      date: new Date(`${date}T00:00:00Z`),
      paidBy: [{ user: alex, amount: 90 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }],
    },
    alex,
  );
const page = (query: string, auth = cookie) =>
  callRoute(GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/expenses?page=1&limit=20${query}`,
    params: { id: groupId },
    cookie: auth,
  });

it('adds the optional ledger window without changing a Month’s visible Expenses or totals', async () => {
  await addExpense('Private November lunch');
  const deleted = await addExpense('Deleted private description');
  await expenseService.delete({ actorId: alex, groupId, expenseId: String(deleted._id) }, 0);
  const payment = await settlementService.create(
    groupId,
    { paidTo: alex, amount: 20, currency: 'INR', note: 'Private payment note' },
    sam,
  );
  const ordinary = await page('&dateFrom=2026-10-01&dateTo=2026-10-31');
  expect(ordinary.status).toBe(200);
  expect(ordinary.body.data.recent).toBeUndefined();
  const opted = await page('&dateFrom=2026-10-01&dateTo=2026-10-31&includeRecent=1');
  expect(opted.status).toBe(200);
  expect(opted.body.data.expenses).toEqual(ordinary.body.data.expenses);
  expect(opted.body.data.summary).toEqual(ordinary.body.data.summary);
  expect(opted.body.data.pagination).toEqual(ordinary.body.data.pagination);
  expect(
    opted.body.data.recent.expenses.map((r: { description: string }) => r.description),
  ).toEqual(['Private November lunch']);
  expect(opted.body.data.recent.settlements[0]).toMatchObject({
    _id: String(payment._id),
    group: groupId,
    amountMinor: 2000,
    currency: 'INR',
    paidBy: { _id: sam, name: 'Sam Chen' },
    paidTo: { _id: alex, name: 'Alex Rivera' },
  });
  expect(JSON.stringify(opted.body.data.recent)).not.toContain('Deleted private description');
  expect(JSON.stringify(opted.body.data.recent)).not.toContain('Private payment note');
});

it('returns current Expense descriptions without edit history and bounds each source to twenty rows', async () => {
  const changed = await addExpense('Old private description');
  await expenseService.update(
    { actorId: alex, groupId, expenseId: String(changed._id) },
    { description: 'Updated lunch' },
    0,
  );
  const edited = await page('&includeRecent=1');
  expect(JSON.stringify(edited.body.data.recent)).not.toContain('Old private description');
  expect(JSON.stringify(edited.body.data.recent)).not.toContain('editHistory');
  for (let i = 0; i < 21; i++) await addExpense(`Meal ${i}`);
  const capped = await page('&includeRecent=1');
  expect(capped.body.data.recent.expenses).toHaveLength(20);
  expect(capped.body.data.recent.settlements.length).toBeLessThanOrEqual(20);
});

it('the optional part follows the same real-session and Group access checks', async () => {
  await addExpense('Member-only lunch');
  expect((await page('&includeRecent=1', '')).status).toBe(401);
  expect((await page('&includeRecent=1', await signIn('priya'))).status).toBe(403);
});

it('projects the reused unfiltered first page to the exact Recent fields', async () => {
  const expense = await addExpense('Recent lunch');
  await expenseService.update(
    { actorId: alex, groupId, expenseId: String(expense._id) },
    { notes: 'Only the Expense screen may show this note' },
    0,
  );
  const answer = await page('&includeRecent=1');
  expect(answer.status).toBe(200);
  expect(answer.body.data.expenses[0].notes).toBe('Only the Expense screen may show this note');
  expect(answer.body.data.expenses[0].createdBy).toMatchObject({ _id: alex });
  const recent = answer.body.data.recent;
  expect(Object.keys(recent.expenses[0]).sort()).toEqual(
    [
      '_id',
      'group',
      'description',
      'amount',
      'amountMinor',
      'moneyVersion',
      'currency',
      'date',
      'createdAt',
      'paidBy',
    ].sort(),
  );
  expect(parseRecentLedgerRead(recent).expenses).toHaveLength(1);
  expect(() =>
    parseRecentLedgerRead({
      ...recent,
      expenses: [{ ...recent.expenses[0], notes: 'Injected extra field' }],
    }),
  ).toThrow();
  expect(() =>
    parseRecentLedgerRead({
      ...recent,
      expenses: [{ ...recent.expenses[0], createdBy: { _id: alex, name: 'Alex' } }],
    }),
  ).toThrow();
  expect(() =>
    parseRecentLedgerRead({
      ...recent,
      expenses: [
        {
          ...recent.expenses[0],
          paidBy: [
            {
              ...recent.expenses[0].paidBy[0],
              user: { _id: alex, name: 'Alex', email: 'private@example.test' },
            },
          ],
        },
      ],
    }),
  ).toThrow();
});

it('includes a newly saved backdated Expense beyond the visible first twenty rows', async () => {
  for (let index = 0; index < 21; index++)
    await addExpense(`Earlier saved meal ${index}`, '2026-11-10');
  const backdated = await addExpense('Newest saved backdated meal', '2026-11-01');
  const answer = await page('&includeRecent=1');
  expect(answer.status).toBe(200);
  expect(answer.body.data.expenses).toHaveLength(20);
  expect(
    answer.body.data.expenses.some((row: { _id: string }) => row._id === String(backdated._id)),
  ).toBe(false);
  expect(answer.body.data.recent.expenses).toHaveLength(20);
  expect(answer.body.data.recent.expenses[0]._id).toBe(String(backdated._id));
});

it('reads only twenty projected Recent Expenses through the creation index, without a sort', async () => {
  const first = await addExpense('Indexed meal');
  const record = await Expense.collection.findOne({ _id: first._id });
  if (!record) throw new Error('Missing fixture Expense');
  await Expense.collection.insertMany(
    Array.from({ length: 999 }, () => ({
      ...record,
      _id: new mongoose.Types.ObjectId(),
      notes: 'Not needed by Recent',
      editHistory: [{ description: 'Not needed by Recent' }],
    })),
  );
  await Expense.init();
  const database = mongoose.connection.db!;
  await database.command({ profile: 2 });
  try {
    const answer = await page('&includeRecent=1');
    expect(answer.status).toBe(200);
    const observed = await database.collection('system.profile').findOne({
      'command.find': 'expenses',
      'command.sort.createdAt': -1,
      'command.sort._id': -1,
      'command.limit': 20,
    });
    if (!observed) throw new Error('Recent find was not observed');
    expect(observed.command.sort).toEqual({ createdAt: -1, _id: -1 });
    expect(Object.keys(observed.command.projection).sort()).toEqual(
      'group description amount amountMinor moneyVersion currency date createdAt paidBy'
        .split(' ')
        .sort(),
    );
    const plan = await database.command({
      explain: {
        find: 'expenses',
        filter: observed.command.filter,
        projection: observed.command.projection,
        sort: observed.command.sort,
        limit: observed.command.limit,
      },
      verbosity: 'executionStats',
    });
    expect(plan.executionStats.nReturned).toBe(20);
    expect(plan.executionStats.totalDocsExamined).toBe(20);
    expect(plan.executionStats.totalKeysExamined).toBe(20);
    const winning = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(winning).toContain('group_1_isDeleted_1_createdAt_-1__id_-1');
    expect(winning).not.toMatch(/"stage":"(?:SORT|COLLSCAN)"/);
    expect(answer.body.data.recent.expenses.map((row: { _id: string }) => row._id)).toEqual(
      (
        await Expense.collection
          .find({ group: record.group, isDeleted: false })
          .sort({ createdAt: -1, _id: -1 })
          .limit(20)
          .project({ _id: 1 })
          .toArray()
      ).map((row) => String(row._id)),
    );
  } finally {
    await database.command({ profile: 0 });
    await database.collection('system.profile').drop();
  }
});
