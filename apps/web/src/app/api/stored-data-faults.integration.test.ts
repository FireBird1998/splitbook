/**
 * HTTP tests for reads that meet stored data they can't use (#547), against a real, isolated
 * MongoDB database (`splitbook-test-stored-data-faults`), with a real session
 * (`signed-in-route.ts`).
 *
 * Every save checks that an Expense's money adds up, so only a fault on our side (a bad
 * migration, an older bug, a manual edit) can store one that doesn't. A read that meets one
 * answers 500 with the standard server-error body, and logs the fault once with the route and the
 * ids that find the record, never member data. A write that computes from the same Expense still
 * refuses with its code, and a read's own bad input is still the request's mistake.
 */

import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { settlementService } from '@/lib/services/settlement.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('stored-data-faults');
const { alex, sam } = DEMO_PERSONA_IDS;

let routes: {
  expenses: typeof import('./groups/[id]/expenses/route');
  expense: typeof import('./groups/[id]/expenses/[expenseId]/route');
  balances: typeof import('./groups/[id]/balances/route');
  homeBalances: typeof import('./user/balances/route');
  spending: typeof import('./user/spending/route');
  insights: typeof import('./groups/[id]/insights/route');
  tripSummary: typeof import('./groups/[id]/trip-summary/route');
  exports: typeof import('./export/route');
};

beforeAll(async () => {
  await connectSignedIn(db);
  routes = {
    expenses: await import('./groups/[id]/expenses/route'),
    expense: await import('./groups/[id]/expenses/[expenseId]/route'),
    balances: await import('./groups/[id]/balances/route'),
    homeBalances: await import('./user/balances/route'),
    spending: await import('./user/spending/route'),
    insights: await import('./groups/[id]/insights/route'),
    tripSummary: await import('./groups/[id]/trip-summary/route'),
    exports: await import('./export/route'),
  };
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's and Sam's one-day trip today, with a ₹1,000.00 dinner Alex paid for, split equally. */
async function tripWithDinner() {
  const today = new Date().toISOString().slice(0, 10);
  const group = await groupService.create(
    {
      name: 'Coorg Weekend',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
      startDate: new Date(today),
      endDate: new Date(today),
    },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const dinner = await expenseService.create(
    groupId,
    {
      description: 'Dinner',
      amount: 1000,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: new Date(`${today}T00:00:00.000Z`),
      paidBy: [{ user: alex, amount: 1000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }],
    },
    alex,
  );
  return {
    groupId,
    expenseId: String(dinner._id),
    month: today.slice(0, 7),
    cookie: await signIn('alex'),
  };
}

/** The trip, after the dinner's stored payer row was changed to ₹900.00: it no longer adds up. */
async function tripWithBrokenDinner() {
  const trip = await tripWithDinner();
  await Expense.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(trip.expenseId) },
    { $set: { 'paidBy.0.amount': 900, 'paidBy.0.amountMinor': 90_000 } },
  );
  return trip;
}

/** The trip, with Sam's ₹300.00 payment to Alex stored as ₹250.00 in one field only. */
async function tripWithBrokenPayment() {
  const trip = await tripWithDinner();
  const payment = await settlementService.create(
    trip.groupId,
    { paidTo: alex, amount: 300, currency: 'INR' },
    sam,
  );
  await Settlement.collection.updateOne({ _id: payment._id }, { $set: { amount: 250 } });
  return trip;
}

/** Answer and log a read, the log's one entry as text. */
async function readLogged(handler: never, path: string, groupId: string, cookie: string) {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const answer = await callRoute(handler, {
      method: 'GET',
      path,
      params: { id: groupId },
      cookie,
    });
    expect(logged).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify(logged.mock.calls[0]);
    // Ids and the code find the record; nothing about the members is written.
    for (const persona of DEMO_PERSONAS) {
      expect(entry).not.toContain(persona.name);
      expect(entry).not.toContain(persona.email);
    }
    expect(entry).not.toContain('Dinner');
    return { answer, entry };
  } finally {
    logged.mockRestore();
  }
}

const SERVER_FAULT = { status: 500, body: { error: 'Internal server error', status: 500 } };

/** Each read the fault reaches, as the route that answers it is called. */
const READS = [
  ['the Expense list', 'expenses', (id: string) => `/api/groups/${id}/expenses`],
  ['the Group’s Balances', 'balances', (id: string) => `/api/groups/${id}/balances`],
  ['Home’s Balances', 'homeBalances', () => '/api/user/balances'],
  ['spending', 'spending', () => '/api/user/spending?months=6&tz=UTC'],
  [
    'Insights',
    'insights',
    (id: string, month: string) => `/api/groups/${id}/insights?month=${month}&tz=UTC`,
  ],
  ['the trip summary', 'tripSummary', (id: string) => `/api/groups/${id}/trip-summary?tz=UTC`],
  ['a CSV export', 'exports', (id: string) => `/api/export?groups=${id}&format=csv`],
  ['a backup', 'exports', (id: string) => `/api/export?groups=${id}&format=json`],
] as const;

/** The reads that add up the Group's payments: Balances, and an export that includes them. */
const PAYMENT_READS = [
  READS[1],
  READS[2],
  [
    'a CSV export with payments',
    'exports',
    (id: string) => `/api/export?groups=${id}&format=csv&include=payments`,
  ],
  [
    'a backup with payments',
    'exports',
    (id: string) => `/api/export?groups=${id}&format=json&include=payments`,
  ],
] as const;

describe('a read that meets stored money that does not add up (#547)', () => {
  for (const [name, route, address] of READS) {
    it(`answers 500 for ${name}, and logs it once with the route, the Group and the Expense`, async () => {
      const { groupId, expenseId, month, cookie } = await tripWithBrokenDinner();
      const path = address(groupId, month);

      const { answer, entry } = await readLogged(routes[route].GET as never, path, groupId, cookie);

      expect(answer).toEqual(SERVER_FAULT);
      expect(entry).toContain(`GET ${path.split('?')[0]}`);
      expect(entry).toContain('UNBALANCED_LEDGER');
      expect(entry).toContain(groupId);
      expect(entry).toContain(expenseId);
    });
  }

  // A payment's stored amount is read where no Expense is: the Group still finds it.
  for (const [name, route, address] of PAYMENT_READS) {
    it(`answers 500 for ${name} when a stored payment's amounts disagree, logging the Group`, async () => {
      const { groupId, cookie } = await tripWithBrokenPayment();
      const path = address(groupId);

      const { answer, entry } = await readLogged(routes[route].GET as never, path, groupId, cookie);

      expect(answer).toEqual(SERVER_FAULT);
      expect(entry).toContain(`GET ${path.split('?')[0]}`);
      expect(entry).toContain('MONEY_REPRESENTATION_MISMATCH');
      expect(entry).toContain(groupId);
    });
  }

  it('keeps refusing an edit of that Expense with its code: a write’s answer is unchanged', async () => {
    const { groupId, expenseId, cookie } = await tripWithBrokenDinner();

    const refused = await callRoute(routes.expense.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie,
      headers: { 'X-Splitbook-Revision': '0' },
      body: { amount: 1200 },
    });

    expect(refused).toEqual({
      status: 422,
      body: {
        error: 'Stored allocations do not equal the Expense amount',
        status: 422,
        code: 'UNBALANCED_LEDGER',
      },
    });
  });

  it('still refuses a read’s own bad input as the request’s mistake', async () => {
    const { groupId, cookie } = await tripWithBrokenDinner();

    const refused = await callRoute(routes.expenses.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/expenses?amountMin=10&amountMax=5`,
      params: { id: groupId },
      cookie,
    });

    expect(refused).toEqual({
      status: 422,
      body: {
        error: 'The lowest amount must not be more than the highest',
        status: 422,
        code: 'INVALID_AMOUNT_RANGE',
      },
    });
  });
});
