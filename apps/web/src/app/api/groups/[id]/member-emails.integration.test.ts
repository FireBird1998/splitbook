/**
 * Whose email address each Group read sends (#517), over HTTP with a real session
 * (`signed-in-route.ts`), against a real, isolated MongoDB database
 * (`splitbook-test-group-member-emails`).
 *
 * Members are sent by id, name and photo. A Group's admin gets its members' addresses in the
 * Group's own read, where Settings shows them, and each member gets their own; no other reply
 * carries an address.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS } from '@/lib/demo-personas';
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

const db = integrationTestDb('group-member-emails');
const { alex, sam } = DEMO_PERSONA_IDS;
const emailOf = (id: string) => DEMO_PERSONAS.find((persona) => persona.id === id)!.email;

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;
let routes: Record<string, Handler>;
let services: {
  group: typeof import('@/lib/services/group.service').groupService;
  expense: typeof import('@/lib/services/expense.service').expenseService;
  settlement: typeof import('@/lib/services/settlement.service').settlementService;
  recurring: typeof import('@/lib/services/recurring-expense.service').recurringExpenseService;
};

beforeAll(async () => {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
  await connectSignedIn(db);
  routes = {
    groups: (await import('../route')).GET as Handler,
    create: (await import('../route')).POST as Handler,
    group: (await import('./route')).GET as Handler,
    balances: (await import('./balances/route')).GET as Handler,
    expenses: (await import('./expenses/route')).GET as Handler,
    expense: (await import('./expenses/[expenseId]/route')).GET as Handler,
    settlements: (await import('./settlements/route')).GET as Handler,
    activity: (await import('./activity/route')).GET as Handler,
    recurring: (await import('./recurring/route')).GET as Handler,
  };
  services = {
    group: (await import('@/lib/services/group.service')).groupService,
    expense: (await import('@/lib/services/expense.service')).expenseService,
    settlement: (await import('@/lib/services/settlement.service')).settlementService,
    recurring: (await import('@/lib/services/recurring-expense.service')).recurringExpenseService,
  };
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** A Household of Alex (admin) and Sam with an Expense, a payment and monthly Rent. */
async function lakeviewFlat() {
  const group = await services.group.create(
    { name: 'Lakeview Flat', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await services.group.addMember(groupId, sam);
  const expense = await services.expense.create(
    groupId,
    {
      description: 'Groceries',
      amount: 900,
      currency: 'INR',
      category: 'food',
      date: new Date('2026-10-10T00:00:00.000Z'),
      paidBy: [{ user: alex, amount: 900 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }],
      tag: 'General',
    },
    alex,
  );
  await services.settlement.create(groupId, { paidTo: alex, amount: 100, currency: 'INR' }, sam);
  await services.recurring.create(
    groupId,
    {
      description: 'Rent',
      amount: 20000,
      currency: 'INR',
      category: 'housing',
      tag: 'General',
      paidBy: [{ user: alex, amount: 20000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }, { user: sam }],
      dayOfMonth: 1,
      startsOn: new Date('2026-10-01T00:00:00.000Z'),
    },
    alex,
  );
  return { groupId, expenseId: String(expense._id) };
}

/** Every Group read, as the member whose cookie it is: each reply's body. */
async function everyRead(cookie: string, groupId: string, expenseId: string) {
  const read = async (name: string, path: string, params?: object) => {
    const answer = await callRoute(routes[name], { method: 'GET', path, params, cookie } as never);
    expect(answer.status, name).toBe(200);
    return [name, answer.body] as const;
  };
  const root = `/api/groups/${groupId}`;
  return Object.fromEntries([
    await read('groups', '/api/groups'),
    await read('group', root, { id: groupId }),
    await read('balances', `${root}/balances`, { id: groupId }),
    await read('expenses', `${root}/expenses`, { id: groupId }),
    await read('expense', `${root}/expenses/${expenseId}`, { id: groupId, expenseId }),
    await read('settlements', `${root}/settlements`, { id: groupId }),
    await read('activity', `${root}/activity`, { id: groupId }),
    await read('recurring', `${root}/recurring`, { id: groupId }),
  ]) as Record<string, unknown>;
}

/** Every email address a reply carries, under an `email` key or anywhere in its text. */
function addresses(body: unknown): string[] {
  return [...new Set(JSON.stringify(body).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])];
}

/** Each member of a Group read, as the reply sends them. */
const members = (body: unknown) =>
  (body as { data: { members: Array<{ user: Record<string, unknown> }> } }).data.members.map(
    ({ user }) => user,
  );

describe('Group reads and email addresses (#517)', () => {
  it('send a member only their own address, and every co-member by id and name', async () => {
    const { groupId, expenseId } = await lakeviewFlat();
    const reads = await everyRead(await signIn('sam'), groupId, expenseId);

    for (const [name, body] of Object.entries(reads))
      expect(addresses(body), name).not.toContain(emailOf(alex));
    // Sam's own address stays in the Group reads, beside Alex sent by id and name.
    expect(members(reads.group)).toEqual([
      { _id: alex, name: 'Alex Rivera' },
      { _id: sam, name: 'Sam Chen', email: emailOf(sam) },
    ]);
    expect(addresses(reads.groups)).toEqual([emailOf(sam)]);
    // The people are still there, named.
    expect(JSON.stringify(reads.expense)).toContain('"name":"Alex Rivera"');
    expect(JSON.stringify(reads.activity)).toContain('"name":"Alex Rivera"');
  });

  it('send the Group’s admin its members’ addresses in the Group’s own read, for Settings, and nowhere else', async () => {
    const { groupId, expenseId } = await lakeviewFlat();
    const reads = await everyRead(await signIn('alex'), groupId, expenseId);

    expect(members(reads.group)).toEqual([
      { _id: alex, name: 'Alex Rivera', email: emailOf(alex) },
      { _id: sam, name: 'Sam Chen', email: emailOf(sam) },
    ]);
    for (const [name, body] of Object.entries(reads))
      if (name !== 'group') expect(addresses(body), name).not.toContain(emailOf(sam));
    expect(addresses(reads.groups)).toEqual([emailOf(alex)]);
  });

  it('send the member who creates a Group their own address in the reply', async () => {
    const created = await callRoute(routes.create, {
      method: 'POST',
      path: '/api/groups',
      cookie: await signIn('alex'),
      body: { name: 'Hill Cabin', category: 'trip', defaultCurrency: 'INR' },
    } as never);

    expect(created.status).toBe(201);
    expect(members(created.body)).toEqual([
      { _id: alex, name: 'Alex Rivera', email: emailOf(alex) },
    ]);
  });
});
