import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { integrationTestDb } from './test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  requireReplicaSet,
  signIn,
} from './test-utils/signed-in-route';
import { pendingActivityFixture } from './test-utils/pending-activity';
import { DEMO_PERSONA_IDS } from './demo-personas';
import Group from './models/Group';
import Expense from './models/Expense';
import RecurringExpense from './models/RecurringExpense';
import Activity from './models/Activity';
vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const db = integrationTestDb('recurring-receipt-index');
let route: typeof import('@/app/api/groups/[id]/expenses/route');
beforeAll(async () => {
  await connectSignedIn(db);
  await requireReplicaSet();
  route = await import('@/app/api/groups/[id]/expenses/route');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => disconnectSignedIn(db));
it('confirms a stored Month even when an unrelated historical duplicate prevents index setup', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11, 12));
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
  vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'false');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await insertDemoPersonas();
  const cookie = await signIn('alex');
  const { alex, sam } = DEMO_PERSONA_IDS;
  const tagId = new Types.ObjectId();
  const group = await Group.create({
    name: 'Receipt recovery',
    category: 'home',
    defaultCurrency: 'INR',
    createdBy: alex,
    members: [
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ],
    tags: [{ _id: tagId, name: 'Groceries' }],
  });
  const money = {
    amount: 120,
    amountMinor: 12000,
    moneyVersion: 1,
    currency: 'INR',
    paidBy: [{ user: alex, amount: 120, amountMinor: 12000 }],
    splitMethod: 'equal' as const,
    splitBetween: [{ user: sam, amount: 120, amountMinor: 12000 }],
  };
  const template = await RecurringExpense.create({
    group: group._id,
    createdBy: alex,
    description: 'Recorded Month',
    ...money,
    tagId,
    tag: 'Groceries',
    category: 'food',
    dayOfMonth: 1,
    startsOn: new Date(2026, 10, 1),
    lastGeneratedFor: null,
  });
  const id = new Types.ObjectId();
  await Expense.create({
    _id: id,
    group: group._id,
    createdBy: alex,
    description: 'Recorded Month',
    ...money,
    tagId,
    tag: 'Groceries',
    category: 'food',
    date: new Date(2026, 10, 1),
    recurringExpense: template._id,
    period: '2026-11',
    pendingActivity: [
      pendingActivityFixture(String(group._id), 'expense_added', alex, { expenseId: String(id) }),
    ],
  });
  await Group.init();
  const index = (await Group.collection.indexes()).find(
    (entry) => entry.key['creationRequest.key'] === 1,
  );
  if (index) await Group.collection.dropIndex(index.name!);
  await Group.collection.insertMany(
    [0, 1].map(() => ({
      name: 'Historical duplicate',
      createdBy: new Types.ObjectId(alex),
      creationRequest: { key: 'duplicate-historical-group' },
    })),
  );
  await expect(
    Group.collection.createIndex(
      { createdBy: 1, 'creationRequest.key': 1 },
      { unique: true, partialFilterExpression: { 'creationRequest.key': { $type: 'string' } } },
    ),
  ).rejects.toMatchObject({ code: 11000 });
  const answer = await callRoute(route.GET, {
    method: 'GET',
    path: `/api/groups/${group._id}/expenses`,
    cookie,
    params: { id: String(group._id) },
  });
  expect(answer.status).toBe(200);
  expect(answer.body.data.expenses).toHaveLength(1);
  expect(await Activity.countDocuments({ group: group._id })).toBe(1);
  expect((await RecurringExpense.findById(template._id))!.lastGeneratedFor).toBe('2026-11');
  expect((await Expense.findById(id).select('+pendingActivity'))!.pendingActivity).toHaveLength(0);
});
