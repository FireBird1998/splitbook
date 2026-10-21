/**
 * A Group's currency settings (#721, spec #710): any member adds an extra currency, up to 4; only
 * an admin removes one, and only while no Expense, Settlement or To review item uses it. The
 * refusal says what still uses it, counting other members' To review items without showing them.
 * Activity names who added or removed which currency, and the settings read shows the main
 * currency's lock. Real routes, a real session and a real replica set.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import Activity from '@/lib/models/Activity';
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

const db = integrationTestDb('group-currency-settings');
const { alex, sam } = DEMO_PERSONA_IDS;
type Persona = 'alex' | 'sam' | 'priya';

let currencies: typeof import('./route');
let currency: typeof import('./[code]/route');
let group: typeof import('../route');
let expenses: typeof import('../expenses/route');
let expense: typeof import('../expenses/[expenseId]/route');
let tagChange: typeof import('../expenses/tag-change/route');
let settlements: typeof import('../settlements/route');
let drafts: typeof import('../drafts/route');
let activity: typeof import('../activity/route');

beforeAll(async () => {
  await connectSignedIn(db);
  currencies = await import('./route');
  currency = await import('./[code]/route');
  group = await import('../route');
  expenses = await import('../expenses/route');
  expense = await import('../expenses/[expenseId]/route');
  tagChange = await import('../expenses/tag-change/route');
  settlements = await import('../settlements/route');
  drafts = await import('../drafts/route');
  activity = await import('../activity/route');
});
beforeEach(async () => {
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Lisbon & Tokyo, a fictional Trip Alex runs: rupees, with Sam as a member. */
async function lisbonAndTokyo(alternateCurrencies = ['EUR', 'JPY', 'GBP']) {
  const created = await groupService.create(
    { name: 'Lisbon & Tokyo', category: 'trip', defaultCurrency: 'INR', alternateCurrencies },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

const read = async (groupId: string, persona: Persona = 'alex') =>
  callRoute(currencies.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/currencies`,
    params: { id: groupId },
    cookie: await signIn(persona),
  });

const add = async (groupId: string, code: unknown, persona: Persona = 'sam') =>
  callRoute(currencies.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/currencies`,
    params: { id: groupId },
    cookie: await signIn(persona),
    body: { currency: code },
  });

const remove = async (groupId: string, code: string, persona: Persona = 'alex') =>
  callRoute(currency.DELETE, {
    method: 'DELETE',
    path: `/api/groups/${groupId}/currencies/${code}`,
    params: { id: groupId, code },
    cookie: await signIn(persona),
  });

/** The Group's extra currencies, as its members read them. */
async function extras(groupId: string) {
  const { status, body } = await callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie: await signIn('alex'),
  });
  expect(status).toBe(200);
  return body.data.alternateCurrencies;
}

/** A dinner Alex paid and shared equally with Sam, on a day of the Trip. */
const dinner = (description: string, amount: number, code: string, day = 10) => ({
  description,
  amount,
  currency: code,
  category: 'food',
  tag: 'Food',
  date: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`,
  paidBy: [{ user: alex, amount }],
  splitMethod: 'equal' as const,
  splitBetween: [{ user: alex }, { user: sam }],
});

async function addExpense(groupId: string, body: object) {
  const { status, body: answer } = await callRoute(expenses.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/expenses`,
    params: { id: groupId },
    cookie: await signIn('alex'),
    body,
  });
  expect(status, JSON.stringify(answer)).toBe(201);
  return answer.data as { _id: string; revision: number };
}

async function addDraft(groupId: string, persona: Persona, body: object, key: string) {
  const { status, body: answer } = await callRoute(drafts.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/drafts`,
    params: { id: groupId },
    cookie: await signIn(persona),
    body: { drafts: [{ ...body, date: '2026-10-11' }] },
    headers: { 'Idempotency-Key': key },
  });
  expect(status, JSON.stringify(answer)).toBe(201);
  return answer.data[0] as { id: string; revision: number };
}

const unused = {
  expenses: { count: 0, items: [] },
  settlements: 0,
  toReview: { yours: 0, others: 0 },
};

describe('GET /api/groups/[id]/currencies (#721)', () => {
  it('shows the main currency, unlocked until money is recorded, and who added each extra', async () => {
    const groupId = await lisbonAndTokyo(['EUR']);

    const empty = await read(groupId, 'sam');

    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({
      mainCurrency: { code: 'INR', locked: false },
      extraCurrencies: [
        {
          code: 'EUR',
          use: unused,
          added: { by: { _id: alex, name: 'Alex Rivera' }, at: expect.any(String) },
        },
      ],
    });

    await addExpense(groupId, dinner('Pastéis de nata', 12, 'EUR'));
    const recorded = await read(groupId, 'sam');
    expect(recorded.body.data.mainCurrency).toEqual({ code: 'INR', locked: true });
    expect(recorded.body.data.extraCurrencies[0].use.expenses).toEqual({
      count: 1,
      items: [{ _id: expect.any(String), description: 'Pastéis de nata' }],
    });
  });

  it('names nobody for a currency an older Group never recorded adding', async () => {
    const groupId = await lisbonAndTokyo(['EUR']);
    // Groups created before #721 recorded only their name when created.
    await Activity.updateOne(
      { group: groupId, type: 'group_created' },
      { $unset: { 'metadata.alternateCurrencies': 1 } },
    );
    await add(groupId, 'CHF');

    const { body } = await read(groupId);

    expect(
      body.data.extraCurrencies.map(({ code, added }: { code: string; added: unknown }) => [
        code,
        added && (added as { by: { _id: string } }).by._id,
      ]),
    ).toEqual([
      ['EUR', null],
      ['CHF', sam],
    ]);
  });

  it('is refused to someone outside the Group', async () => {
    const groupId = await lisbonAndTokyo();
    expect(await read(groupId, 'priya')).toEqual({
      status: 403,
      body: { error: 'Forbidden', status: 403 },
    });
  });
});

describe('POST /api/groups/[id]/currencies (#721)', () => {
  it('lets a member who isn’t an admin add one, and Activity names them', async () => {
    const groupId = await lisbonAndTokyo();

    const added = await add(groupId, 'CHF', 'sam');

    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.data.extraCurrencies.map(({ code }: { code: string }) => code)).toEqual([
      'EUR',
      'JPY',
      'GBP',
      'CHF',
    ]);
    expect(added.body.data.extraCurrencies[3]).toEqual({
      code: 'CHF',
      use: unused,
      added: { by: { _id: sam, name: 'Sam Chen' }, at: expect.any(String) },
    });
    expect(await extras(groupId)).toEqual(['EUR', 'JPY', 'GBP', 'CHF']);
    const { body } = await callRoute(activity.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/activity`,
      params: { id: groupId },
      cookie: await signIn('alex'),
    });
    expect(body.data.activities[0]).toMatchObject({
      type: 'group_updated',
      actor: { _id: sam },
      metadata: {
        changes: {
          alternateCurrencies: { old: ['EUR', 'JPY', 'GBP'], new: ['EUR', 'JPY', 'GBP', 'CHF'] },
        },
        // What the list became, kept as it was then, so a later change never rewrites it.
        groupName: 'Lisbon & Tokyo',
        currencies: ['INR', 'EUR', 'JPY', 'GBP', 'CHF'],
      },
    });
  });

  it('refuses a fifth, an unsupported code, one already listed or the main currency', async () => {
    const groupId = await lisbonAndTokyo(['EUR', 'JPY', 'GBP', 'USD']);
    const smaller = await lisbonAndTokyo(['EUR']);
    for (const [target, code, message] of [
      [groupId, 'CHF', 'A Group can have at most 4 extra currencies.'],
      [smaller, 'XYZ', 'XYZ isn’t a supported currency.'],
      [smaller, 'EUR', 'EUR is already one of this Group’s currencies.'],
      [smaller, 'INR', 'INR is the main currency, so it can’t also be an extra currency.'],
    ] as const) {
      expect(await add(target, code), code).toEqual({
        status: 422,
        body: {
          error: message,
          status: 422,
          code: 'INVALID_GROUP_CURRENCIES',
          field: ['currency'],
        },
      });
    }
    expect(await extras(groupId)).toEqual(['EUR', 'JPY', 'GBP', 'USD']);
    expect(await extras(smaller)).toEqual(['EUR']);
    expect((await add(smaller, 42)).status).toBe(422);
  });

  it('adds only one of two at once when one place is left', async () => {
    const groupId = await lisbonAndTokyo();

    const answers = await Promise.all([add(groupId, 'CHF', 'sam'), add(groupId, 'SGD', 'alex')]);

    expect(answers.map(({ status }) => status).sort()).toEqual([201, 422]);
    expect(await extras(groupId)).toHaveLength(4);
  });

  it('is refused to someone outside the Group', async () => {
    const groupId = await lisbonAndTokyo();
    expect(await add(groupId, 'CHF', 'priya')).toEqual({
      status: 403,
      body: { error: 'Forbidden', status: 403 },
    });
    expect(await extras(groupId)).toEqual(['EUR', 'JPY', 'GBP']);
  });
});

describe('DELETE /api/groups/[id]/currencies/[code] (#721)', () => {
  it('lets an admin remove one nothing uses, and Activity names them', async () => {
    const groupId = await lisbonAndTokyo();

    const removed = await remove(groupId, 'GBP');

    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.data.extraCurrencies.map(({ code }: { code: string }) => code)).toEqual([
      'EUR',
      'JPY',
    ]);
    expect(await extras(groupId)).toEqual(['EUR', 'JPY']);
    const { body } = await callRoute(activity.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/activity`,
      params: { id: groupId },
      cookie: await signIn('sam'),
    });
    expect(body.data.activities[0]).toMatchObject({
      type: 'group_updated',
      actor: { _id: alex },
      metadata: {
        changes: { alternateCurrencies: { old: ['EUR', 'JPY', 'GBP'], new: ['EUR', 'JPY'] } },
        groupName: 'Lisbon & Tokyo',
        currencies: ['INR', 'EUR', 'JPY'],
      },
    });
  });

  it('refuses a member who isn’t an admin, and someone outside the Group', async () => {
    const groupId = await lisbonAndTokyo();
    for (const persona of ['sam', 'priya'] as const) {
      expect(await remove(groupId, 'GBP', persona), persona).toEqual({
        status: 403,
        body: { error: 'Forbidden', status: 403 },
      });
    }
    expect(await extras(groupId)).toEqual(['EUR', 'JPY', 'GBP']);
  });

  it('refuses one the Group doesn’t list, and the main currency as a conflict', async () => {
    const groupId = await lisbonAndTokyo();
    expect(await remove(groupId, 'USD')).toEqual({
      status: 404,
      body: {
        error: 'USD isn’t one of this Group’s extra currencies.',
        status: 404,
        code: 'CURRENCY_NOT_LISTED',
      },
    });
    // The main currency is a conflict with the Group's state, like its lock.
    expect(await remove(groupId, 'INR')).toEqual({
      status: 409,
      body: {
        error: 'INR is the main currency, so it can’t be removed.',
        status: 409,
        code: 'CURRENCY_IS_MAIN',
      },
    });
    expect(await extras(groupId)).toEqual(['EUR', 'JPY', 'GBP']);
  });

  it('refuses one still in use, listing what uses it and counting others’ To review items', async () => {
    const groupId = await lisbonAndTokyo();
    const ramen = await addExpense(groupId, dinner('Ramen at Ichiran', 2500, 'JPY', 9));
    await addExpense(groupId, dinner('Taxi to Haneda', 6800, 'JPY', 8));
    await addExpense(groupId, dinner('Tram 28', 6, 'EUR'));
    await addDraft(groupId, 'sam', dinner('Sushi breakfast', 4200, 'JPY'), 'draft-sam-jpy-0001');
    await addDraft(groupId, 'sam', dinner('Onsen', 3000, 'JPY'), 'draft-sam-jpy-0002');
    const mine = await addDraft(groupId, 'alex', dinner('Matcha', 900, 'JPY'), 'draft-alex-jpy-1');

    const refused = await remove(groupId, 'JPY');

    expect(refused).toEqual({
      status: 409,
      body: {
        error: 'JPY can’t be removed while Lisbon & Tokyo uses it.',
        status: 409,
        code: 'CURRENCY_IN_USE',
        use: {
          expenses: {
            count: 2,
            items: [
              { _id: ramen._id, description: 'Ramen at Ichiran' },
              { _id: expect.any(String), description: 'Taxi to Haneda' },
            ],
          },
          settlements: 0,
          toReview: { yours: 1, others: 2 },
        },
      },
    });
    expect(JSON.stringify(refused.body)).not.toMatch(/Sushi breakfast|Onsen/);
    expect(await extras(groupId)).toEqual(['EUR', 'JPY', 'GBP']);
    const samRead = await read(groupId, 'sam');
    expect(samRead.body.data.extraCurrencies[1].use.toReview).toEqual({ yours: 2, others: 1 });

    // Once nothing uses it, the same removal goes through.
    for (const id of (await read(groupId)).body.data.extraCurrencies[1].use.expenses.items.map(
      (item: { _id: string }) => item._id,
    )) {
      const current = await expenseService.getById({ actorId: alex, groupId, expenseId: id });
      await expenseService.delete({ actorId: alex, groupId, expenseId: id }, current!.revision);
    }
    const { expenseDraftService } = await import('@/lib/services/expense-draft.service');
    await expenseDraftService.discard({ id: alex }, groupId, mine.id, mine.revision);
    for (const draft of await expenseDraftService.list({ id: sam }, groupId))
      await expenseDraftService.discard({ id: sam }, groupId, draft.id, draft.revision);
    expect((await remove(groupId, 'JPY')).status).toBe(200);
    expect(await extras(groupId)).toEqual(['EUR', 'GBP']);
  });

  it('refuses one a Settlement uses', async () => {
    const groupId = await lisbonAndTokyo();
    await addExpense(groupId, dinner('Fado night', 40, 'EUR'));
    const paid = await callRoute(settlements.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/settlements`,
      params: { id: groupId },
      cookie: await signIn('sam'),
      body: { paidTo: alex, amount: 20, currency: 'EUR' },
    });
    expect(paid.status).toBe(201);

    const refused = await remove(groupId, 'EUR');

    expect(refused.status).toBe(409);
    expect(refused.body.use).toMatchObject({ expenses: { count: 1 }, settlements: 1 });
  });

  it('keeps a deleted Expense from coming back in a currency the Group no longer lists', async () => {
    const groupId = await lisbonAndTokyo();
    const tea = await addExpense(groupId, dinner('Afternoon tea', 30, 'GBP'));
    const deleted = await expenseService.delete(
      { actorId: alex, groupId, expenseId: tea._id },
      tea.revision,
    );
    expect((await remove(groupId, 'GBP')).status).toBe(200);

    const restored = await callRoute(expense.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}/expenses/${tea._id}`,
      params: { id: groupId, expenseId: tea._id },
      cookie: await signIn('alex'),
      body: { isDeleted: false },
      headers: { 'X-Splitbook-Revision': String(deleted!.revision) },
    });

    expect(restored.status).toBe(422);
    expect(restored.body).toMatchObject({
      error: 'Currency is not one of this Group’s currencies',
      code: 'CURRENCY_MISMATCH',
    });
    expect(
      (await expenseService.getById({ actorId: alex, groupId, expenseId: tea._id }))?.isDeleted,
    ).toBe(true);
  });
});

describe('an older Expense in a currency the Group doesn’t list (#721)', () => {
  it('can still be edited while it keeps its currency', async () => {
    const groupId = await lisbonAndTokyo();
    const tea = await addExpense(groupId, dinner('Afternoon tea', 30, 'GBP'));
    // An older Group's list could leave out a currency its Expenses use.
    await Group.updateOne({ _id: groupId }, { $set: { alternateCurrencies: ['EUR'] } });

    const edited = await callRoute(expense.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}/expenses/${tea._id}`,
      params: { id: groupId, expenseId: tea._id },
      cookie: await signIn('alex'),
      body: { description: 'High tea', currency: 'GBP' },
      headers: { 'X-Splitbook-Revision': String(tea.revision) },
    });

    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data).toMatchObject({ description: 'High tea', currency: 'GBP' });
  });

  it('can still move to another Tag, keeping its currency', async () => {
    const groupId = await lisbonAndTokyo();
    const tea = await addExpense(groupId, dinner('Afternoon tea', 30, 'GBP'));
    await Group.updateOne({ _id: groupId }, { $set: { alternateCurrencies: ['EUR'] } });
    const stored = await Group.findById(groupId).lean();
    const tagId = String(stored!.tags.find((tag) => tag.name !== 'Food')!._id);

    const changed = await callRoute(tagChange.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/expenses/tag-change`,
      params: { id: groupId },
      cookie: await signIn('alex'),
      body: { tagId, expenses: [{ id: tea._id, revision: tea.revision }] },
    });

    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data.results).toMatchObject([{ expenseId: tea._id, outcome: 'changed' }]);
    expect(
      await expenseService.getById({ actorId: alex, groupId, expenseId: tea._id }),
    ).toMatchObject({ tagId, currency: 'GBP' });
  });
});

describe('PATCH /api/groups/[id] keeps the same rules for the extra currencies (#721)', () => {
  const update = async (groupId: string, body: object) =>
    callRoute(group.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}`,
      params: { id: groupId },
      cookie: await signIn('alex'),
      body,
    });

  it('refuses to drop a currency still in use, and drops one nothing uses', async () => {
    const groupId = await lisbonAndTokyo();
    await addExpense(groupId, dinner('Ramen at Ichiran', 2500, 'JPY'));

    const refused = await update(groupId, { alternateCurrencies: ['EUR'] });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: 'JPY can’t be removed while Lisbon & Tokyo uses it.',
      code: 'CURRENCY_IN_USE',
      use: { expenses: { count: 1 } },
    });
    expect(await extras(groupId)).toEqual(['EUR', 'JPY', 'GBP']);
    expect((await update(groupId, { alternateCurrencies: ['EUR', 'JPY'] })).status).toBe(200);
    expect(await extras(groupId)).toEqual(['EUR', 'JPY']);
  });

  it('still refuses a new main currency once money is recorded (the lock)', async () => {
    const groupId = await lisbonAndTokyo();
    await addExpense(groupId, dinner('Dinner', 1200, 'INR'));

    expect(await update(groupId, { defaultCurrency: 'USD' })).toEqual({
      status: 409,
      body: {
        error: 'Currency cannot change after this Group has financial records.',
        status: 409,
        code: 'CURRENCY_LOCKED',
      },
    });
    expect((await read(groupId)).body.data.mainCurrency).toEqual({ code: 'INR', locked: true });
  });
});
