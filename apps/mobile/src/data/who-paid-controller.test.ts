import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import { giveRest, payerRemainder } from './payer-remainder';
import type { MobileFetch } from './types';

// #122: the Who paid sheet's arithmetic and "Give the rest" through the controller's draft.
const memberIds = [
  'a00000000000000000000001',
  'a00000000000000000000002',
  'a00000000000000000000003',
];
const formerId = 'a00000000000000000000099';
const groupId = 'a00000000000000000000010';
const tagId = 'a00000000000000000000020';
const iso = '2026-09-28T10:00:00.000Z';
const people = memberIds.map((id, i) => ({
  id,
  name: ['Alex Rivera', 'Sam Chen', 'Priya Shah'][i],
  email: `person${i}@example.test`,
  image: null,
}));
const group = {
  _id: groupId,
  createdBy: memberIds[0],
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  members: people.map(({ id, ...user }) => ({
    user: { _id: id, ...user },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });

async function setup() {
  const posts: unknown[] = [];
  const records = new Map<string, unknown>();
  const drafts = {
    load: async (accountId: string, id: string) =>
      structuredClone(records.get(`${accountId}:${id}`) ?? null),
    save: async (accountId: string, id: string, value: unknown) => {
      records.set(`${accountId}:${id}`, structuredClone(value));
    },
    remove: async (accountId: string, id: string) => {
      records.delete(`${accountId}:${id}`);
    },
    clear: async () => records.clear(),
  };
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === `/api/groups/${groupId}/expenses` && init.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return json({ status: 201, data: { _id: tagId, group: groupId } }, 201);
    }
    if (path.endsWith('/demo-persona/sign-in'))
      return json(
        { user: people[0] },
        200,
        'better-auth.session_token=alex.signature; Max-Age=2592000',
      );
    if (path.endsWith('/get-session'))
      return json({
        user: people[0],
        session: { userId: people[0].id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (path === '/api/groups') return json({ data: [group], status: 200 });
    if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
    if (path.endsWith('/expenses'))
      return json({
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
        status: 200,
      });
    if (path.endsWith('/balances'))
      return json({ data: { currency: 'INR', balances: [], debts: [], byCurrency: [] } });
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  let cookie: string | null = null;
  let account: string | null = null;
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      fetch,
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      expenseDrafts: drafts,
      accountLocal: {
        owner: {
          load: async () => account,
          save: async (value) => {
            account = value;
          },
          clear: async () => {
            account = null;
          },
        },
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
        stores: [drafts],
      },
      now: () => Date.parse(iso),
      newSubmissionKey: () => 'native-expense-test-0001',
    },
  );
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Weekly groceries', tagId });
  const expense = () => controller.getSnapshot().expense;
  const stored = () =>
    (records.get(`${memberIds[0]}:${groupId}`) as { draft: { payers: unknown } }).draft;
  return { controller, posts, expense, stored };
}

describe('Who paid, several people', () => {
  it('gives the rest to the first empty payer as an ordinary draft entry and sends nothing until Save', async () => {
    const { controller, posts, expense, stored } = await setup();
    await controller.updateExpenseDraft({
      amount: '1249.50',
      multiPayer: true,
      payers: [
        { user: memberIds[0], amount: '1000.00' },
        { user: memberIds[1], amount: '200.00' },
      ],
    });
    expect(payerRemainder(expense().draft!).remainingMinor).toBe(4950);
    controller.touchExpenseField('payers');
    expect(expense().validation.errors.payers).toBe(
      'Payer amounts must add up to the expense amount',
    );

    await controller.updateExpenseDraft(giveRest(expense().draft!, memberIds)!);
    const filled = [
      { user: memberIds[0], amount: '1000.00' },
      { user: memberIds[1], amount: '200.00' },
      { user: memberIds[2], amount: '49.50' },
    ];
    expect(expense().draft!.payers).toEqual(filled);
    expect(stored().payers).toEqual(filled);
    expect(payerRemainder(expense().draft!).remainingMinor).toBe(0);
    expect(expense().validation.errors).toEqual({});
    expect(expense().status).toBe('editing');
    expect(posts).toEqual([]);

    await controller.saveExpense();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      amount: 1249.5,
      paidBy: [
        { user: memberIds[0], amount: 1000 },
        { user: memberIds[1], amount: 200 },
        { user: memberIds[2], amount: 49.5 },
      ],
    });
  });

  it('counts a blank entry as no payment, and asks who paid when nothing is entered', async () => {
    const { controller, posts, expense } = await setup();
    await controller.updateExpenseDraft({
      amount: '10',
      multiPayer: true,
      payers: [{ user: memberIds[1], amount: '' }],
    });
    await controller.saveExpense();
    expect(posts).toEqual([]);
    expect(expense().validation.errors).toEqual({ payers: 'Choose who paid.' });

    await controller.updateExpenseDraft({
      payers: [
        { user: memberIds[1], amount: '' },
        { user: memberIds[2], amount: '10' },
      ],
    });
    expect(expense().validation.errors).toEqual({});
    await controller.saveExpense();
    expect(posts).toHaveLength(1);
    expect((posts[0] as { paidBy: unknown }).paidBy).toEqual([{ user: memberIds[2], amount: 10 }]);
  });

  it('explains an unavailable payer on Paid by and saves once that payer is removed', async () => {
    const { controller, posts, expense } = await setup();
    await controller.updateExpenseDraft({
      amount: '10',
      multiPayer: true,
      payers: [
        { user: formerId, amount: '4' },
        { user: memberIds[0], amount: '6' },
      ],
    });
    await controller.saveExpense();
    expect(posts).toEqual([]);
    expect(expense().validation.errors).toEqual({
      payers: 'A payer is no longer in this Group. Choose who paid.',
    });

    await controller.updateExpenseDraft({
      payers: giveRest(
        { ...expense().draft!, payers: [{ user: memberIds[0], amount: '6' }] },
        memberIds,
      )!.payers,
    });
    expect(expense().draft!.payers).toEqual([
      { user: memberIds[0], amount: '6' },
      { user: memberIds[1], amount: '4.00' },
    ]);
    await controller.saveExpense();
    expect(posts).toHaveLength(1);
  });
});
