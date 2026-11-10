import { expenseReceipt } from '../test-utils/expense-receipt';
import type { AccountGroupRecordStore } from './account-record-storage';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook, expensePage } from '../test-utils/fake-splitbook';
import { describe, expect, it } from 'vitest';
import { giveRest, payerRemainder } from '@splitbook/shared/payer-remainder';

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
  const server = fakeSplitbook();
  server.world.people = { alex: people[0], sam: people[1], priya: people[2] };
  server.world.groups = [group];
  server.world.expenses[groupId] = expensePage();
  server.world.balances[groupId] = { currency: 'INR', balances: [], debts: [], byCurrency: [] };
  server.reply('POST', `/api/groups/${groupId}/expenses`, ({ body }) => {
    posts.push(body);
    return json(
      { status: 201, data: expenseReceipt(group, body, 'e00000000000000000000001', memberIds[0]) },
      201,
    );
  });
  const phone = testPhone(server, {
    now: Date.parse(iso),
    recordSeparator: ':',
    newSubmissionKey: () => 'native-expense-test-0001',
    purge: ['expenseDrafts'],
    parts: {
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      accountLocal: {
        financialCleanup: undefined,
        untrustedCopies: undefined,
        signOutRecord: undefined,
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
      },
    },
  });
  // The original Draft adapter did not enumerate values for Home.
  delete (phone.stores.expenseDrafts as AccountGroupRecordStore).list;
  delete (phone.stores.expenseDrafts as AccountGroupRecordStore).keys;
  const controller = phone.open(),
    records = phone.stores.expenseDrafts.records;
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

  it('counts an entry of 0 as blank, so that person is never sent as a payer', async () => {
    // #187: 0 is not a payment, even from someone who has left the Group.
    const { controller, posts, expense } = await setup();
    await controller.updateExpenseDraft({
      amount: '10',
      multiPayer: true,
      payers: [{ user: memberIds[1], amount: '0' }],
    });
    await controller.saveExpense();
    expect(posts).toEqual([]);
    expect(expense().validation.errors).toEqual({ payers: 'Choose who paid.' });

    await controller.updateExpenseDraft({
      payers: [
        { user: memberIds[1], amount: '0.00' },
        { user: formerId, amount: '0' },
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
