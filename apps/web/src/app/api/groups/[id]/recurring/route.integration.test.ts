/**
 * HTTP tests for a Group's recurring Expenses collection (#473) against a real, isolated MongoDB
 * database (`splitbook-test-recurring-collection-route`), with a real session
 * (`signed-in-route.ts`).
 *
 * A recurring Expense passes the same gate as other ledger writes: only a Household admin
 * creates one, only members read the list, and while the product switch is off (#289) nothing
 * is created. A month that is already due reaches the ledger, read back through the balances
 * route. The item route's own test (`[recurringId]`) covers edits and deletion.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
  validationIssues,
} from '@/lib/test-utils/signed-in-route';
import { toPeriod } from '@splitbook/shared/recurring-due-periods';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('recurring-collection-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let recurring: typeof import('./route');
let balances: typeof import('../balances/route');

beforeAll(async () => {
  await connectSignedIn(db);
  recurring = await import('./route');
  balances = await import('../balances/route');
});
beforeEach(async () => {
  // Recurring Expenses are off unless switched on (#289); a test that needs them off says so.
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's and Sam's Household, with Alex as its admin and nothing in its ledger. */
async function household() {
  const group = await groupService.create(
    { name: 'Lakeview Flat', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

/** ₹30,000.00 Rent on the 1st, paid by Alex and split equally, starting this month. */
const monthlyRent = {
  description: 'Rent',
  amount: 30000,
  currency: 'INR',
  category: 'housing',
  tag: 'Rent',
  paidBy: [{ user: alex, amount: 30000 }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
  dayOfMonth: 1,
  startsOn: `${toPeriod(new Date())}-01`,
};

function addRecurring(groupId: string, cookie: string, body: object) {
  return callRoute(recurring.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/recurring`,
    params: { id: groupId },
    cookie,
    body,
  });
}

function listRecurring(groupId: string, cookie: string) {
  return callRoute(recurring.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/recurring`,
    params: { id: groupId },
    cookie,
  });
}

async function templates(groupId: string, cookie: string) {
  const listed = await listRecurring(groupId, cookie);
  expect(listed.status).toBe(200);
  return listed.body.data.map((template: { description: string; amount: number }) => ({
    description: template.description,
    amount: template.amount,
  }));
}

async function debts(groupId: string, cookie: string) {
  const { status, body } = await callRoute(balances.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/balances`,
    params: { id: groupId },
    cookie,
  });
  expect(status).toBe(200);
  return body.data.debts.map(
    (debt: { from: { _id: string }; to: { _id: string }; amount: number }) => ({
      from: debt.from._id,
      to: debt.to._id,
      amount: debt.amount,
    }),
  );
}

describe('POST and GET /api/groups/[id]/recurring', () => {
  it('lets the Household admin add a monthly Rent whose due month reaches the ledger', async () => {
    const groupId = await household();

    const created = await addRecurring(groupId, await signIn('alex'), monthlyRent);

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ description: 'Rent', amount: 30000, dayOfMonth: 1 });
    const samCookie = await signIn('sam');
    expect(await templates(groupId, samCookie)).toEqual([{ description: 'Rent', amount: 30000 }]);
    expect(await debts(groupId, samCookie)).toEqual([{ from: sam, to: alex, amount: 15000 }]);
  });

  it('refuses a member who is not the admin and adds nothing', async () => {
    const groupId = await household();
    const samCookie = await signIn('sam');

    const refused = await addRecurring(groupId, samCookie, {
      ...monthlyRent,
      paidBy: [{ user: sam, amount: 30000 }],
    });

    expect(refused).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    expect(await templates(groupId, samCookie)).toEqual([]);
    expect(await debts(groupId, samCookie)).toEqual([]);
  });

  it('refuses someone who is not in the Household, to read or to add', async () => {
    const groupId = await household();
    const priyaCookie = await signIn('priya');

    const read = await listRecurring(groupId, priyaCookie);
    const added = await addRecurring(groupId, priyaCookie, monthlyRent);

    expect([read, added]).toEqual([
      { status: 403, body: { error: 'Forbidden', status: 403 } },
      { status: 403, body: { error: 'Forbidden', status: 403 } },
    ]);
    expect(await templates(groupId, await signIn('alex'))).toEqual([]);
  });

  it('adds nothing while recurring Expenses are off', async () => {
    const groupId = await household();
    const alexCookie = await signIn('alex');
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'false');

    const refused = await addRecurring(groupId, alexCookie, monthlyRent);

    expect(refused).toEqual({
      status: 409,
      body: {
        error: 'Recurring Expenses are turned off.',
        status: 409,
        code: 'RECURRING_EXPENSES_OFF',
      },
    });
    // While the switch is off the list is empty whatever is stored, so read it back switched on.
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    expect(await templates(groupId, alexCookie)).toEqual([]);
    expect(await debts(groupId, alexCookie)).toEqual([]);
  });

  it('refuses a Rent with Sam’s exact share left out, at that row of the split (#497)', async () => {
    const groupId = await household();
    const alexCookie = await signIn('alex');

    const refused = await addRecurring(groupId, alexCookie, {
      ...monthlyRent,
      splitMethod: 'exact',
      splitBetween: [{ user: alex, amount: 18000 }, { user: sam }],
    });

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(validationIssues(refused.body)).toEqual([
      {
        code: 'custom',
        message: 'Enter an amount for each person in the split',
        path: ['splitBetween', 1, 'amount'],
      },
    ]);
    expect(await templates(groupId, alexCookie)).toEqual([]);
  });
});

describe('POST /api/groups/[id]/recurring refusals name their code (#523)', () => {
  /** A Trip Alex runs with Sam: a Theme without recurring Expenses. */
  async function trip() {
    const group = await groupService.create(
      { name: 'Coast trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
      alex,
    );
    const groupId = String(group._id);
    await groupService.addMember(groupId, sam);
    return groupId;
  }

  it.each([
    {
      code: 'NOT_HOUSEHOLD',
      error: 'Recurring expenses are only available in Household groups',
      setup: trip,
      change: {},
    },
    {
      code: 'INVALID_WINDOW',
      error: 'End date must be on or after the start date',
      setup: household,
      change: { startsOn: '2026-08-01', endsOn: '2026-07-31' },
    },
    {
      code: 'INVALID_MEMBERS',
      error: 'All payers and split participants must be group members',
      setup: household,
      change: { paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 30000 }] },
    },
    {
      code: 'INVALID_TAG',
      error: 'Tag must be an active group tag',
      setup: household,
      change: { tag: 'Synthetic missing tag' },
    },
    {
      code: 'CURRENCY_MISMATCH',
      error: 'Currency must match the group default currency',
      setup: household,
      change: { currency: 'USD' },
    },
  ])('answers 422 $code and adds nothing', async ({ code, error, setup, change }) => {
    const groupId = await setup();
    const alexCookie = await signIn('alex');

    const refused = await addRecurring(groupId, alexCookie, { ...monthlyRent, ...change });

    expect(refused).toEqual({ status: 422, body: { error, status: 422, code } });
    expect(await templates(groupId, alexCookie)).toEqual([]);
  });
});
