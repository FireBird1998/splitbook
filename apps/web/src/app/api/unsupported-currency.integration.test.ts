/**
 * #820: an Expense in a currency Splitbook no longer supports, such as a legacy DEM row, against
 * a real, isolated MongoDB database (`splitbook-test-unsupported-currency`). Stored money
 * outlives today's currency list (#779, #810, #812): such an Expense is listed as stored, never
 * converted, has no position, and Spent carries it as its own line. So Export lists it, the
 * spending, Insights and Trip summary reads leave it out, and it can be deleted; every one of
 * them answered 500 before. It can't be changed: an edit is refused as the request's fault.
 */

import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import { exportService } from '@/lib/services/export.service';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { exportPath } from '@splitbook/shared/api-paths';
import type { ExportRequest } from '@splitbook/shared/export-request';
import { GET as readExport } from './export/route';
import { GET as readSpending } from './user/spending/route';
import { GET as readInsights } from './groups/[id]/insights/route';
import { GET as readTripSummary } from './groups/[id]/trip-summary/route';
import {
  DELETE as deleteExpense,
  PATCH as changeExpense,
} from './groups/[id]/expenses/[expenseId]/route';
import { POST as changeTags } from './groups/[id]/expenses/tag-change/route';

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

const db = integrationTestDb('unsupported-currency');
const { alice, bob } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob');
  session.userId = alice;
});
afterAll(db.teardown);

/** A Trip in rupees, 14 to 20 September: Alice paid two Expenses she shares with Bob. */
async function berlinTrip(): Promise<string> {
  const group = await groupService.create(
    {
      name: 'Fictional Berlin trip',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
      startDate: new Date(2026, 8, 14, 12),
      endDate: new Date(2026, 8, 20, 12),
    },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  for (const [description, amount, day] of [
    ['Station lunch', 1240, 15],
    ['Museum tickets', 600, 16],
  ] as const)
    await expenseService.create(
      groupId,
      {
        description,
        amount,
        currency: 'INR',
        category: 'food',
        date: new Date(2026, 8, day, 12),
        tag: 'Food',
        paidBy: [{ user: alice, amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: alice }, { user: bob }],
      },
      alice,
    );
  return groupId;
}

/** A versioned row in Deutsche Marks, as an old database holds it: Alice paid DM 40 for both. */
async function oldBerlinRent(groupId: string, at = new Date(2026, 8, 17, 12)): Promise<string> {
  const { insertedId } = await Expense.collection.insertOne({
    group: new mongoose.Types.ObjectId(groupId),
    description: 'Old Berlin rent',
    amount: 40,
    amountMinor: 4000,
    moneyVersion: 1,
    currency: 'DEM',
    category: 'housing',
    date: at,
    paidBy: [{ user: new mongoose.Types.ObjectId(alice), amount: 40, amountMinor: 4000 }],
    splitMethod: 'equal',
    splitBetween: [
      { user: new mongoose.Types.ObjectId(alice), amount: 20, amountMinor: 2000 },
      { user: new mongoose.Types.ObjectId(bob), amount: 20, amountMinor: 2000 },
    ],
    tag: 'Food',
    createdBy: new mongoose.Types.ObjectId(alice),
    isDeleted: false,
    revision: 0,
    createdAt: at,
    updatedAt: at,
  });
  return String(insertedId);
}

type Route = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

/** A read's answer, as text: every route here answers JSON or a file. */
async function get(read: unknown, path: string, id?: string) {
  const response = await (read as Route)(new Request(`http://localhost${path}`), {
    params: Promise.resolve({ id: id ?? '' }),
  });
  return { status: response.status, text: await response.text() };
}

// Shares only: with payments, the CSV comes as a zip of two files.
const exportRequest = (groupId: string, extra: Partial<ExportRequest> = {}): ExportRequest => ({
  groupIds: [groupId],
  include: ['shares'],
  format: 'csv',
  timeZone: 'UTC',
  ...extra,
});

/** The DEM row as stored, every field. */
const storedRow = (expenseId: string) =>
  Expense.collection.findOne({ _id: new mongoose.Types.ObjectId(expenseId) });

const refusal = {
  status: 422,
  code: 'UNSUPPORTED_CURRENCY',
  error:
    'This Expense is in DEM, which Splitbook no longer supports. It can’t be changed, only deleted.',
};

describe('an Expense in a currency Splitbook no longer supports (#820)', () => {
  it.each([
    ['Home’s spending', () => ['/api/user/spending?months=6&tz=UTC', readSpending] as const],
    [
      'the Group’s Insights',
      (id: string) => [`/api/groups/${id}/insights?tz=UTC&month=2026-09`, readInsights] as const,
    ],
    [
      'the Trip summary',
      (id: string) => [`/api/groups/${id}/trip-summary?tz=UTC`, readTripSummary] as const,
    ],
  ])('%s leaves it out, answering exactly as before', async (_, route) => {
    const groupId = await berlinTrip();
    const [path, read] = route(groupId);
    const before = await get(read, path, groupId);
    expect(before.status).toBe(200);
    await oldBerlinRent(groupId);
    const after = await get(read, path, groupId);
    expect(after.status).toBe(200);
    expect(JSON.parse(after.text)).toEqual(JSON.parse(before.text));
  });

  it('Insights doesn’t start the Group’s Months at it when it is the oldest Expense', async () => {
    const groupId = await berlinTrip();
    const path = `/api/groups/${groupId}/insights?tz=UTC&month=2026-09&compare=5`;
    const before = await get(readInsights, path, groupId);
    expect(before.status).toBe(200);
    await oldBerlinRent(groupId, new Date(2026, 6, 10, 12));
    const after = await get(readInsights, path, groupId);
    expect(after.status).toBe(200);
    expect(JSON.parse(after.text)).toEqual(JSON.parse(before.text));
  });

  it('Export’s CSV lists it as stored, with its code, and every other row as before', async () => {
    const groupId = await berlinTrip();
    const path = exportPath(exportRequest(groupId));
    const before = await get(readExport, path);
    expect(before.status).toBe(200);
    await oldBerlinRent(groupId);
    const after = await get(readExport, path);
    expect(after.status).toBe(200);
    const lines = after.text.split('\r\n');
    for (const line of before.text.split('\r\n').slice(1)) expect(lines).toContain(line);
    const marks = lines.find((line) => line.includes('Old Berlin rent'));
    expect(marks).toContain('DEM');
    expect(marks).toContain('40.00');
  });

  it('Export’s backup keeps it as stored, and every other Expense as before', async () => {
    const groupId = await berlinTrip();
    const path = exportPath(exportRequest(groupId, { format: 'json' }));
    const before = JSON.parse((await get(readExport, path)).text);
    await oldBerlinRent(groupId);
    const after = await get(readExport, path);
    expect(after.status).toBe(200);
    const expenses = JSON.parse(after.text).groups[0].expenses as Array<{
      description: string;
      currency: string;
      amountMinor: number;
    }>;
    expect(expenses.find((row) => row.description === 'Old Berlin rent')).toMatchObject({
      currency: 'DEM',
      amountMinor: 4000,
    });
    expect(expenses.filter((row) => row.currency !== 'DEM')).toEqual(before.groups[0].expenses);
  });

  // The CSV preview shows its rows; the backup preview counts the Expenses, the DEM one too.
  it.each([
    ['csv', 'Old Berlin rent'],
    ['json', '"expenses":3'],
  ] as const)('Export’s %s preview answers with it listed', async (format, shown) => {
    const groupId = await berlinTrip();
    await oldBerlinRent(groupId);
    const after = await get(
      readExport,
      exportPath(exportRequest(groupId, { format, preview: true })),
    );
    expect(after.status).toBe(200);
    expect(after.text).toContain(shown);
  });

  it('the statement gives it a Spent line of its own, with no position, and the rupees as before', async () => {
    const groupId = await berlinTrip();
    const request = exportRequest(groupId, { include: ['payments'] });
    const before = await exportService.statement(alice, request);
    await oldBerlinRent(groupId);
    const after = await exportService.statement(alice, request);
    const inr = (statement: typeof before) =>
      statement.currencies.find((bucket) => bucket.currency === 'INR');
    expect(inr(after)).toEqual(inr(before));
    expect(after.currencies.find((bucket) => bucket.currency === 'DEM')).toMatchObject({
      spentMinor: 4000,
      expenseCount: 1,
      people: [],
      suggestedPayments: [],
      expenses: [expect.objectContaining({ description: 'Old Berlin rent', amountMinor: 4000 })],
    });
  });

  it('can be deleted, and stays listed as deleted', async () => {
    const groupId = await berlinTrip();
    const expenseId = await oldBerlinRent(groupId);
    const response = await deleteExpense(
      new Request(`http://localhost/api/groups/${groupId}/expenses/${expenseId}`, {
        method: 'DELETE',
        headers: { 'X-Splitbook-Revision': '0' },
      }),
      { params: Promise.resolve({ id: groupId, expenseId }) },
    );
    expect(response.status).toBe(200);
    expect(await Expense.findById(expenseId).lean()).toMatchObject({
      isDeleted: true,
      currency: 'DEM',
      amountMinor: 4000,
    });
  });

  // A refusal, not a server fault: a 500 reads as an outage, and invites a retry.
  it.each([
    ['an edit of its description', { description: 'Old Berlin flat' }],
    ['an edit of its amount', { amount: 50 }],
    ['an edit with nothing new', { description: 'Old Berlin rent' }],
    ['a restore once it is deleted', { isDeleted: false }],
  ])('%s is refused, and nothing stored changes', async (_, change) => {
    const groupId = await berlinTrip();
    const expenseId = await oldBerlinRent(groupId);
    if ('isDeleted' in change)
      await expenseService.delete({ actorId: alice, groupId, expenseId }, 0);
    const before = await storedRow(expenseId);
    const response = await changeExpense(
      new Request(`http://localhost/api/groups/${groupId}/expenses/${expenseId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Splitbook-Revision': String(before!.revision),
        },
        body: JSON.stringify(change),
      }),
      { params: Promise.resolve({ id: groupId, expenseId }) },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(refusal);
    expect(await storedRow(expenseId)).toEqual(before);
  });

  it('a Tag change refuses it in those words, and changes the others', async () => {
    const groupId = await berlinTrip();
    const expenseId = await oldBerlinRent(groupId);
    const before = await storedRow(expenseId);
    const tags = (await Group.findById(groupId).lean())!.tags;
    const transport = String(tags.find((tag) => tag.name === 'Transport')!._id);
    const lunch = await Expense.findOne({ description: 'Station lunch' }).lean();
    const response = await changeTags(
      new Request(`http://localhost/api/groups/${groupId}/expenses/tag-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagId: transport,
          expenses: [
            { id: expenseId, revision: 0 },
            { id: String(lunch!._id), revision: 0 },
          ],
        }),
      }),
      { params: Promise.resolve({ id: groupId }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.results).toEqual([
      { expenseId, outcome: 'refused', code: refusal.code, reason: refusal.error },
      { expenseId: String(lunch!._id), outcome: 'changed', revision: 1 },
    ]);
    expect(await storedRow(expenseId)).toEqual(before);
  });
});
