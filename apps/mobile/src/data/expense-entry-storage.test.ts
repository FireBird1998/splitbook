import { expect, it } from 'vitest';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { testPhone } from '../test-utils/test-phone';

const [alex, sam, priya] = [
  'a00000000000000000000001',
  'a00000000000000000000002',
  'a00000000000000000000003',
];
const tagId = 'a00000000000000000000020';

it.each(['equal', 'unequal', 'exact', 'percentage', 'shares'] as const)(
  'opens a current version-1 %s record with every typed value unchanged after a restart',
  async (splitMethod) => {
    const server = fakeSplitbook();
    const groupId = server.world.groups[0]._id;
    const phone = testPhone(server, { now: Date.parse('2026-09-28T12:00:00.000Z') });
    await phone.open().signIn('alex');
    // A record written by the current app: no conversion to the new shared shape is needed.
    // Both modes, blank/zero/invalid entries and an unticked person's value must remain typed.
    const draft = {
      amount: '00100.00',
      currency: 'INR',
      description: 'Existing typed Expense',
      date: '2026-09-28',
      payerId: sam,
      multiPayer: true,
      payers: [
        { user: alex, amount: '40.00' },
        { user: sam, amount: '60' },
        { user: priya, amount: '0' },
      ],
      splitMethod,
      splitValues: { [alex]: '2', [sam]: '', [priya]: 'not a number' },
      participantIds: [sam, alex],
      category: 'other',
      tagId,
      notes: 'Kept as typed',
    };
    await phone.stores.expenseDrafts.save(alex, groupId, {
      version: 1,
      accountId: alex,
      groupId,
      draft,
    });
    const app = phone.open();
    await app.restore();
    await app.openExpense(groupId);
    expect(app.getSnapshot().expense.status).toBe('resume');
    expect(app.getSnapshot().expense.draft).toEqual(draft);
    app.resumeExpenseDraft();
    expect(app.getSnapshot().expense.draft).toEqual(draft);
    expect(await phone.stores.expenseDrafts.load(alex, groupId)).toMatchObject({
      version: 1,
      draft,
    });
    expect(
      server.sent().filter((request) => /^(POST|PATCH|DELETE) \/api\/groups/.test(request)),
    ).toEqual([]);
  },
);

it('opens the pinned pre-custom-splits version-1 record without reinterpreting any typed value', async () => {
  const server = fakeSplitbook();
  const groupId = server.world.groups[0]._id;
  const phone = testPhone(server, { now: Date.parse('2026-09-28T12:00:00.000Z') });
  await phone.open().signIn('alex');
  // The literal draft pinned by expense-controller.test.ts before custom splits were stored.
  const draft = {
    amount: '10',
    currency: 'INR',
    description: 'Existing draft',
    date: '2026-09-28',
    payerId: alex,
    participantIds: [alex, sam, priya],
    category: 'other',
    tagId,
    notes: '',
  };
  await phone.stores.expenseDrafts.save(alex, groupId, {
    version: 1,
    accountId: alex,
    groupId,
    draft,
  });
  const app = phone.open();
  await app.restore();
  await app.openExpense(groupId);
  expect(app.getSnapshot().expense.status).toBe('resume');
  expect(app.getSnapshot().expense.draft).toEqual({
    ...draft,
    multiPayer: false,
    payers: [],
    splitMethod: 'equal',
    splitValues: {},
  });
  expect(app.getSnapshot().expense.preview?.map((row) => row.amountMinor)).toEqual([334, 333, 333]);
  expect(await phone.stores.expenseDrafts.load(alex, groupId)).toMatchObject({ version: 1, draft });
  expect(
    server.sent().filter((request) => /^(POST|PATCH|DELETE) \/api\/groups/.test(request)),
  ).toEqual([]);
});
