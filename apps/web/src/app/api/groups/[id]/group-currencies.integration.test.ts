/**
 * A Group's extra currencies (#719, spec #710): creating and updating them under the Group's
 * currency rule, an older Group's list read and saved as the rule allows, and Expenses, edits,
 * Settlements and Drafts in any of the Group's currencies, each kept in its own currency, never
 * converted. Real routes, a real session and a real replica set.
 */

import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import Group from '@/lib/models/Group';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);

const db = integrationTestDb('group-currencies');
const { alex, sam } = DEMO_PERSONA_IDS;

let groups: typeof import('../route');
let group: typeof import('./route');
let expenses: typeof import('./expenses/route');
let expense: typeof import('./expenses/[expenseId]/route');
let settlements: typeof import('./settlements/route');
let balances: typeof import('./balances/route');
let drafts: typeof import('./drafts/route');
let review: typeof import('./drafts/review/route');
let recurring: typeof import('./recurring/route');
let home: typeof import('../../user/balances/route');

beforeAll(async () => {
  await connectSignedIn(db);
  groups = await import('../route');
  group = await import('./route');
  expenses = await import('./expenses/route');
  expense = await import('./expenses/[expenseId]/route');
  settlements = await import('./settlements/route');
  balances = await import('./balances/route');
  drafts = await import('./drafts/route');
  review = await import('./drafts/review/route');
  recurring = await import('./recurring/route');
  home = await import('../../user/balances/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

const NOT_LISTED = {
  error: 'Currency is not one of this Group’s currencies',
  code: 'CURRENCY_MISMATCH',
};

/** Lisbon & Tokyo, Alex's and Sam's fictional Trip: rupees, with euros and yen as extras. */
async function lisbonAndTokyo(alternateCurrencies = ['EUR', 'JPY']) {
  const created = await groupService.create(
    { name: 'Lisbon & Tokyo', category: 'trip', defaultCurrency: 'INR', alternateCurrencies },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

/** A dinner Alex paid and shared equally with Sam. */
const dinner = (amount: number, currency: string, description = 'Dinner') => ({
  description,
  amount,
  currency,
  category: 'food',
  tag: 'Food',
  date: '2026-10-10T12:00:00.000Z',
  paidBy: [{ user: alex, amount }],
  splitMethod: 'equal' as const,
  splitBetween: [{ user: alex }, { user: sam }],
});

async function addExpense(groupId: string, body: object) {
  return callRoute(expenses.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/expenses`,
    params: { id: groupId },
    cookie: await signIn('alex'),
    body,
  });
}

describe("creating and updating a Group's currencies (#719)", () => {
  const create = async (alternateCurrencies: string[]) =>
    callRoute(groups.POST, {
      method: 'POST',
      path: '/api/groups',
      cookie: await signIn('alex'),
      body: {
        name: 'Lisbon & Tokyo',
        category: 'trip',
        defaultCurrency: 'INR',
        alternateCurrencies,
      },
    });
  const update = async (groupId: string, body: object) =>
    callRoute(group.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}`,
      params: { id: groupId },
      cookie: await signIn('alex'),
      body,
    });

  it('takes up to 4 extra currencies', async () => {
    const { status, body } = await create(['EUR', 'JPY', 'USD', 'GBP']);
    expect(status).toBe(201);
    expect(body.data.alternateCurrencies).toEqual(['EUR', 'JPY', 'USD', 'GBP']);
    const groupId = body.data._id;
    const changed = await update(groupId, { alternateCurrencies: ['EUR', 'JPY'] });
    expect(changed.status).toBe(200);
    expect(changed.body.data.alternateCurrencies).toEqual(['EUR', 'JPY']);
  });

  it('refuses a fifth, an unsupported code, a repeat or the main currency', async () => {
    for (const [list, message] of [
      [['EUR', 'JPY', 'USD', 'GBP', 'AUD'], 'A Group can have at most 4 extra currencies.'],
      [['EUR', 'XYZ'], 'XYZ isn’t a supported currency.'],
      [['EUR', 'EUR'], 'EUR is listed twice.'],
      [['INR'], 'INR is the main currency, so it can’t also be an extra currency.'],
    ] as const) {
      const { status, body } = await create([...list]);
      expect(status, list.join()).toBe(422);
      expect(body.details).toEqual([{ path: ['alternateCurrencies'], message }]);
    }
  });

  it('refuses a new main currency that is already an extra currency', async () => {
    const groupId = await lisbonAndTokyo();
    const { status, body } = await update(groupId, { defaultCurrency: 'EUR' });
    expect(status).toBe(422);
    expect(body).toMatchObject({
      code: 'INVALID_GROUP_CURRENCIES',
      error: 'EUR is the main currency, so it can’t also be an extra currency.',
      field: ['alternateCurrencies'],
    });
    expect((await Group.findById(groupId).lean())!.defaultCurrency).toBe('INR');
  });

  it('reads an older Group’s list as the rule allows, and saves its settings without failing', async () => {
    const groupId = await lisbonAndTokyo([]);
    // Stored before the rule: an unknown code, repeats, the main currency and more than 4.
    await mongoose.connection
      .db!.collection('groups')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(groupId) },
        { $set: { alternateCurrencies: ['EUR', 'XYZ', 'EUR', 'INR', 'JPY', 'USD', 'GBP', 'AUD'] } },
      );
    const read = await callRoute(group.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}`,
      params: { id: groupId },
      cookie: await signIn('sam'),
    });
    expect(read.body.data.alternateCurrencies).toEqual(['EUR', 'JPY', 'USD', 'GBP']);
    const renamed = await update(groupId, { name: 'Lisbon, Tokyo & Seoul' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.alternateCurrencies).toEqual(['EUR', 'JPY', 'USD', 'GBP']);
    expect((await Group.findById(groupId).lean())!.alternateCurrencies).toEqual([
      'EUR',
      'JPY',
      'USD',
      'GBP',
    ]);
  });
});

describe("an Expense in any of the Group's currencies (#719)", () => {
  it('saves in an extra currency, whole yen included, and refuses one the Group doesn’t list', async () => {
    const groupId = await lisbonAndTokyo();
    const euros = await addExpense(groupId, dinner(42.5, 'EUR'));
    expect(euros.status).toBe(201);
    expect(euros.body.data).toMatchObject({ amount: 42.5, currency: 'EUR' });
    const yen = await addExpense(groupId, dinner(2500, 'JPY', 'Ramen at Ichiran'));
    expect(yen.status).toBe(201);
    expect(yen.body.data).toMatchObject({ amount: 2500, currency: 'JPY' });
    expect(yen.body.data.splitBetween.map((row: { amount: number }) => row.amount)).toEqual([
      1250, 1250,
    ]);
    const dollars = await addExpense(groupId, dinner(30, 'USD'));
    expect(dollars.status).toBe(422);
    expect(dollars.body).toMatchObject(NOT_LISTED);
  });

  it('takes an edit to another listed currency, and refuses an unlisted one', async () => {
    const groupId = await lisbonAndTokyo();
    const created = await addExpense(groupId, dinner(1000, 'INR'));
    const expenseId = created.body.data._id;
    const edit = async (body: object, revision: number) =>
      callRoute(expense.PATCH, {
        method: 'PATCH',
        path: `/api/groups/${groupId}/expenses/${expenseId}`,
        params: { id: groupId, expenseId },
        cookie: await signIn('alex'),
        headers: { 'X-Splitbook-Revision': String(revision) },
        body,
      });
    const toYen = await edit(
      {
        amount: 1800,
        currency: 'JPY',
        paidBy: [{ user: alex, amount: 1800 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
      created.body.data.revision,
    );
    expect(toYen.status).toBe(200);
    expect(toYen.body.data).toMatchObject({ amount: 1800, currency: 'JPY' });
    const toDollars = await edit(
      {
        amount: 20,
        currency: 'USD',
        paidBy: [{ user: alex, amount: 20 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }],
      },
      toYen.body.data.revision,
    );
    expect(toDollars.status).toBe(422);
    expect(toDollars.body).toMatchObject(NOT_LISTED);
  });
});

describe("Settlements and Drafts in the Group's currencies (#719)", () => {
  it('records a payment in an extra currency, and refuses one the Group doesn’t list', async () => {
    const groupId = await lisbonAndTokyo();
    await addExpense(groupId, dinner(40, 'EUR'));
    const pay = async (currency: string) =>
      callRoute(settlements.POST, {
        method: 'POST',
        path: `/api/groups/${groupId}/settlements`,
        params: { id: groupId },
        cookie: await signIn('sam'),
        body: { paidTo: alex, amount: 20, currency },
      });
    const euros = await pay('EUR');
    expect(euros.status).toBe(201);
    expect(euros.body.data).toMatchObject({ amount: 20, currency: 'EUR' });
    const dollars = await pay('USD');
    expect(dollars.status).toBe(422);
    expect(dollars.body).toMatchObject(NOT_LISTED);
  });

  it('keeps a Draft in an extra currency ready to save, and one in an unlisted currency not', async () => {
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
    const groupId = await lisbonAndTokyo();
    const cookie = await signIn('alex');
    const kept = await callRoute(drafts.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/drafts`,
      params: { id: groupId },
      cookie,
      body: {
        drafts: [
          { ...dinner(2500, 'JPY', 'Ramen'), date: '2026-10-10' },
          { ...dinner(30, 'USD', 'Tacos'), date: '2026-10-10' },
        ],
      },
      headers: { 'Idempotency-Key': 'draft-alex-currencies-0001' },
    });
    expect(kept.status, JSON.stringify(kept.body)).toBe(201);
    const ids = kept.body.data.map((draft: { id: string }) => draft.id);
    const reviewed = await callRoute(review.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/drafts/review`,
      params: { id: groupId },
      cookie,
      body: { ids },
    });
    expect(reviewed.status).toBe(200);
    const [ramen, tacos] = reviewed.body.data;
    expect(ramen.problems).toEqual([]);
    expect(ramen.allocation).toMatchObject({ currency: 'JPY' });
    expect(tacos.problems).toEqual(['CURRENCY_MISMATCH']);
  });
});

describe("each of the Group's currencies balances on its own (#719)", () => {
  it('keeps the euro Debt and its payment apart from the rupee one, never converted', async () => {
    const groupId = await lisbonAndTokyo();
    await expenseService.create(groupId, { ...dinner(1000, 'INR'), date: new Date() }, alex);
    await expenseService.create(
      groupId,
      { ...dinner(40, 'EUR', 'Pastéis'), date: new Date() },
      alex,
    );
    await callRoute(settlements.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/settlements`,
      params: { id: groupId },
      cookie: await signIn('sam'),
      body: { paidTo: alex, amount: 15, currency: 'EUR' },
    });
    const { status, body } = await callRoute(balances.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/balances`,
      params: { id: groupId },
      cookie: await signIn('sam'),
    });
    expect(status).toBe(200);
    const debts = Object.fromEntries(
      body.data.byCurrency.map(
        (bucket: { currency: string; debts: { from: { _id: string }; amount: number }[] }) => [
          bucket.currency,
          bucket.debts.map((debt) => [debt.from._id, debt.amount]),
        ],
      ),
    );
    expect(debts).toEqual({ INR: [[sam, 500]], EUR: [[sam, 5]] });
    const bucket = (currency: string) =>
      body.data.byCurrency.find((entry: { currency: string }) => entry.currency === currency);
    const balanceOf = (currency: string) =>
      Object.fromEntries(
        bucket(currency).balances.map((row: { user: { _id: string }; balance: number }) => [
          row.user._id,
          row.balance,
        ]),
      );
    expect(balanceOf('INR')).toEqual({ [alex]: 500, [sam]: -500 });
    expect(balanceOf('EUR')).toEqual({ [alex]: 5, [sam]: -5 });
    // The Group's own figures are still the main currency's.
    expect(body.data.currency).toBe('INR');
    // Home's Suggested payments list each currency's payment on its own, in exact minor units.
    const homeRead = await callRoute(home.GET, {
      method: 'GET',
      path: '/api/user/balances',
      cookie: await signIn('sam'),
    });
    expect(homeRead.status).toBe(200);
    expect(
      homeRead.body.data.suggestedPayments.map(
        (row: { currency: string; direction: string; amountMinor: number }) => [
          row.currency,
          row.direction,
          row.amountMinor,
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        ['INR', 'pay', 50_000],
        ['EUR', 'pay', 500],
      ]),
    );
    expect(homeRead.body.data.suggestedPayments).toHaveLength(2);
  });
});

describe("the currency a member's next Expense starts in (#719)", () => {
  it('is read with the Group: the member’s latest Expense’s here, or none', async () => {
    const groupId = await lisbonAndTokyo();
    const read = async (persona: 'alex' | 'sam') =>
      (
        await callRoute(group.GET, {
          method: 'GET',
          path: `/api/groups/${groupId}`,
          params: { id: groupId },
          cookie: await signIn(persona),
        })
      ).body.data.latestExpenseCurrency;
    expect(await read('alex')).toBeNull();
    await addExpense(groupId, dinner(42.5, 'EUR'));
    await addExpense(groupId, dinner(2500, 'JPY', 'Ramen'));
    expect(await read('alex')).toBe('JPY');
    // Sam added nothing, so Sam's next Expense starts in the main currency.
    expect(await read('sam')).toBeNull();
    const listed = await callRoute(groups.GET, {
      method: 'GET',
      path: '/api/groups',
      cookie: await signIn('alex'),
    });
    expect(
      listed.body.data.find((entry: { _id: string }) => entry._id === groupId)
        .latestExpenseCurrency,
    ).toBe('JPY');
  });
});

describe("an older Group's list, and the main currency's lock (#719)", () => {
  /** Lisbon & Tokyo with a list stored before the rule: euros twice and a retired code. */
  async function olderGroup() {
    const groupId = await lisbonAndTokyo([]);
    await mongoose.connection
      .db!.collection('groups')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(groupId) },
        { $set: { alternateCurrencies: ['EUR', 'EUR', 'DEM'] } },
      );
    return groupId;
  }

  it('still takes a new member and an archive, which save the Group as it is', async () => {
    const groupId = await olderGroup();
    await expect(groupService.addMember(groupId, DEMO_PERSONA_IDS.priya)).resolves.toBeTruthy();
    await expect(groupService.archive(groupId, alex)).resolves.toBeTruthy();
  });

  it('saves the list as read without logging it as a member’s change', async () => {
    const groupId = await olderGroup();
    const saved = await callRoute(group.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}`,
      params: { id: groupId },
      cookie: await signIn('alex'),
      body: { name: 'Lisbon, Tokyo & Seoul', alternateCurrencies: ['EUR'] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      alternateCurrencies: ['EUR'],
      latestExpenseCurrency: null,
    });
    const logged = await mongoose.connection
      .db!.collection('activities')
      .find({ group: new mongoose.Types.ObjectId(groupId), type: 'group_updated' })
      .toArray();
    expect(logged.map((entry) => Object.keys(entry.metadata.changes))).toEqual([['name']]);
  });

  it('says the main currency is locked before anything about the extra currencies', async () => {
    const groupId = await lisbonAndTokyo();
    await addExpense(groupId, dinner(1000, 'INR'));
    const { status, body } = await callRoute(group.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}`,
      params: { id: groupId },
      cookie: await signIn('alex'),
      body: { defaultCurrency: 'EUR' },
    });
    expect(status).toBe(409);
    expect(body.code).toBe('CURRENCY_LOCKED');
  });
});

describe('a recurring Expense, which stays in the main currency (#710)', () => {
  it('refuses an extra currency', async () => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    const created = await groupService.create(
      {
        name: 'Lakeview Flat',
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: ['EUR'],
      },
      alex,
    );
    const groupId = String(created._id);
    const { status, body } = await callRoute(recurring.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/recurring`,
      params: { id: groupId },
      cookie: await signIn('alex'),
      body: {
        description: 'Streaming',
        amount: 12,
        currency: 'EUR',
        category: 'other',
        tag: 'Utilities',
        paidBy: [{ user: alex, amount: 12 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }],
        dayOfMonth: 1,
        startsOn: '2026-11-01',
      },
    });
    expect(status).toBe(422);
    expect(body).toMatchObject(NOT_LISTED);
  });
});
