import { describe, expect, it } from 'vitest';
import { parseActivityPage } from './activity';
import { expenseRecordSchema, parseExpenseRecord } from './expense-record';
import { parseExpensePage, parseGroupBalances, parseHomeBalances } from './financial-dto';

// #211: Android's parse functions read through the shared decoders and keep their own checks.
// These pin what each one returns and rejects, so the switch changes neither. Fictional data.
const groupId = 'b00000000000000000000001';
const otherGroup = 'b00000000000000000000002';
const expenseId = 'c00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';
const iso = '2026-09-27T10:00:00.000Z';
const person = { _id: sam, name: 'Sam Chen', image: null, email: 'sam@example.test' };
const clone = <T>(value: T): T => structuredClone(value);

describe('parseGroupBalances', () => {
  const response = {
    status: 200,
    data: {
      currency: 'INR',
      balances: [],
      debts: [],
      byCurrency: [
        {
          currency: 'INR',
          balances: [
            { user: person, balance: -30, extra: true },
            { user: priya, balance: 30 },
            { user: null, balance: 0 },
          ],
          debts: [{ from: person, to: { _id: priya, name: '  ' }, amount: 30 }],
        },
      ],
      hasMixedCurrencies: false,
    },
  };

  it('maps each currency to Android figures and people', () => {
    expect(parseGroupBalances(clone(response))).toStrictEqual([
      {
        currency: 'INR',
        balances: [
          { user: { id: sam, name: 'Sam Chen', image: null }, balance: -30 },
          { user: { id: priya, name: 'Former member', image: null }, balance: 30 },
          { user: { id: null, name: 'Former member', image: null }, balance: 0 },
        ],
        debts: [
          {
            from: { id: sam, name: 'Sam Chen', image: null },
            to: { id: priya, name: 'Former member', image: null },
            amount: 30,
          },
        ],
      },
    ]);
  });

  it.each([
    [
      'a historical currency',
      (body: typeof response) => (body.data.byCurrency[0].currency = 'DEM'),
    ],
    [
      'an inexact balance',
      (body: typeof response) => (body.data.byCurrency[0].balances[0].balance = 10.005),
    ],
    [
      'an inexact debt',
      (body: typeof response) => (body.data.byCurrency[0].debts[0].amount = 0.001),
    ],
    ['a zero debt', (body: typeof response) => (body.data.byCurrency[0].debts[0].amount = 0)],
    [
      'a malformed person',
      (body: typeof response) => (body.data.byCurrency[0].balances[1].user = 'sam'),
    ],
    ['a wrong status', (body: typeof response) => (body.status = 201)],
  ])('rejects %s', (_label, change) => {
    const body = clone(response);
    change(body);
    expect(() => parseGroupBalances(body)).toThrow();
  });
});

const expense = {
  _id: expenseId,
  group: groupId,
  description: 'Groceries',
  currency: 'INR',
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  category: 'food',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
  splitBetween: [
    { user: person, amount: 5, amountMinor: 500 },
    { user: null, amount: 5, amountMinor: 500 },
  ],
  splitMethod: 'equal',
  isDeleted: false,
};
const expensePage = {
  status: 200,
  data: {
    expenses: [expense],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1, extra: 'kept on the wire' },
    summary: {
      count: 1,
      totalAmount: 10,
      totalsByCurrency: [{ currency: 'INR', totalAmount: 10 }],
      userOwes: 0,
      userGetsBack: 5,
      byMember: [{ user: person, paid: 10, share: 5, net: -5 }],
    },
  },
};

describe('parseExpensePage', () => {
  it('maps the page to Android Expenses, with only the fields Android reads', () => {
    expect(parseExpensePage(clone(expensePage), groupId, 'INR')).toStrictEqual({
      expenses: [
        {
          id: expenseId,
          groupId,
          description: 'Groceries',
          currency: 'INR',
          amount: 10,
          amountMinor: 1000,
          date: new Date(iso),
          createdAt: new Date(iso),
          updatedAt: new Date(iso),
          category: 'food',
          tag: '',
          tagId: null,
          paidBy: [
            { user: { id: sam, name: 'Sam Chen', image: null }, amountMinor: 1000, amount: 10 },
          ],
          splitBetween: [
            { user: { id: sam, name: 'Sam Chen', image: null }, amountMinor: 500, amount: 5 },
            { user: { id: null, name: 'Former member', image: null }, amountMinor: 500, amount: 5 },
          ],
          splitMethod: 'equal',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      summary: {
        currency: 'INR',
        count: 1,
        totalsByCurrency: [{ currency: 'INR', totalAmount: 10 }],
        userOwes: 0,
        userGetsBack: 5,
        byMember: [
          { user: { id: sam, name: 'Sam Chen', image: null }, paid: 10, share: 5, net: -5 },
        ],
      },
    });
  });

  it('keeps a Tag, and reads a page without the member breakdown', () => {
    const body = clone(expensePage);
    Object.assign(body.data.expenses[0], { tag: 'Shared', tagId: 'd00000000000000000000001' });
    delete (body.data.summary as { byMember?: unknown }).byMember;
    const page = parseExpensePage(body, groupId, 'INR');
    expect(page.expenses[0]).toMatchObject({ tag: 'Shared', tagId: 'd00000000000000000000001' });
    expect(page.summary.byMember).toStrictEqual([]);
  });

  it.each([
    ['a 50-row page', (body: typeof expensePage) => (body.data.pagination.limit = 50)],
    ['a 1-row page', (body: typeof expensePage) => (body.data.pagination.limit = 1)],
    [
      'a count that disagrees with the total',
      (body: typeof expensePage) => (body.data.summary.count = 2),
    ],
    [
      'an Expense of another Group',
      (body: typeof expensePage) => (body.data.expenses[0].group = otherGroup),
    ],
    [
      'a historical Expense currency',
      (body: typeof expensePage) => (body.data.expenses[0].currency = 'DEM'),
    ],
    [
      'a historical total currency',
      (body: typeof expensePage) => (body.data.summary.totalsByCurrency[0].currency = 'DEM'),
    ],
    [
      'an inexact total',
      (body: typeof expensePage) => (body.data.summary.totalsByCurrency[0].totalAmount = 10.005),
    ],
    ['an inexact owed amount', (body: typeof expensePage) => (body.data.summary.userOwes = 0.001)],
    [
      'an inexact member share',
      (body: typeof expensePage) => (body.data.summary.byMember[0].share = 5.005),
    ],
    [
      'unbalanced Expense money',
      (body: typeof expensePage) => (body.data.expenses[0].amountMinor = 999),
    ],
    ['a malformed date', (body: typeof expensePage) => (body.data.expenses[0].date = 'yesterday')],
    [
      'an unknown split',
      (body: typeof expensePage) => (body.data.expenses[0].splitMethod = 'magic'),
    ],
    [
      'a missing summary',
      (body: typeof expensePage) => delete (body.data as { summary?: unknown }).summary,
    ],
  ])('rejects %s', (_label, change) => {
    const body = clone(expensePage);
    change(body);
    expect(() => parseExpensePage(body, groupId, 'INR')).toThrow();
  });
});

describe('parseHomeBalances', () => {
  const response = {
    status: 200,
    data: {
      buckets: [
        { currency: 'EUR', youOwe: 0, youAreOwed: 42.5, net: 42.5 },
        { currency: 'INR', youOwe: 1480, youAreOwed: 620, net: -860 },
      ],
      groups: [
        {
          groupId,
          name: 'Maple House',
          balances: [
            { currency: 'INR', balance: -1480, settlement: { counterpartyId: sam, amount: 1480 } },
          ],
        },
        { groupId: otherGroup, name: 'Sunday Football', balances: [] },
      ],
      hasMixedCurrencies: true,
    },
  };

  it('maps totals and each Group balance', () => {
    expect(parseHomeBalances(clone(response))).toStrictEqual({
      buckets: [
        { currency: 'EUR', youOwe: 0, youAreOwed: 42.5 },
        { currency: 'INR', youOwe: 1480, youAreOwed: 620 },
      ],
      byGroup: {
        [groupId]: [{ currency: 'INR', balance: -1480 }],
        [otherGroup]: [],
      },
    });
  });

  it('reads totals without Group balances', () => {
    const body = clone(response);
    delete (body.data as { groups?: unknown }).groups;
    expect(parseHomeBalances(body).byGroup).toStrictEqual({});
  });

  it.each([
    [
      'a historical bucket currency',
      (body: typeof response) => (body.data.buckets[0].currency = 'DEM'),
    ],
    [
      'a historical Group balance currency',
      (body: typeof response) => (body.data.groups[0].balances[0].currency = 'DEM'),
    ],
    ['an inexact bucket', (body: typeof response) => (body.data.buckets[1].youOwe = 0.001)],
    [
      'an inexact Group balance',
      (body: typeof response) => (body.data.groups[0].balances[0].balance = 1.005),
    ],
    ['a negative bucket', (body: typeof response) => (body.data.buckets[1].youAreOwed = -1)],
    ['a malformed Group id', (body: typeof response) => (body.data.groups[0].groupId = 'maple')],
  ])('rejects %s', (_label, change) => {
    const body = clone(response);
    change(body);
    expect(() => parseHomeBalances(body)).toThrow();
  });
});

const event = {
  _id: 'e00000000000000000000001',
  group: groupId,
  type: 'expense_added',
  actor: { _id: sam, name: 'Sam Chen', image: null },
  createdAt: iso,
  metadata: { expenseId, description: 'Dinner', amount: 12.34, currency: 'INR', extra: 1 },
  extra: 'kept on the wire',
};
type ActivityEventResponse = Omit<typeof event, 'actor' | 'metadata'> & {
  actor: unknown;
  metadata: (typeof event)['metadata'] | null;
};
const activityPage = (activities: ActivityEventResponse[] = [event], page = 1) => ({
  status: 200,
  data: {
    activities,
    pagination: { page, limit: 20, total: activities.length, totalPages: 1, extra: true },
  },
});

describe('parseActivityPage', () => {
  it('returns Android events with only the fields Android reads', () => {
    const formerActor = { ...event, _id: 'e00000000000000000000002', actor: priya, metadata: null };
    const missingActor = { ...event, _id: 'e00000000000000000000003', actor: null };
    expect(
      parseActivityPage(activityPage([event, formerActor, missingActor, event]), groupId, 1),
    ).toStrictEqual({
      events: [
        {
          _id: event._id,
          group: groupId,
          type: 'expense_added',
          actor: { _id: sam, name: 'Sam Chen' },
          createdAt: iso,
          metadata: { expenseId, description: 'Dinner', amount: 12.34, currency: 'INR' },
        },
        {
          _id: formerActor._id,
          group: groupId,
          type: 'expense_added',
          actor: { _id: priya, name: 'Former member' },
          createdAt: iso,
          metadata: {},
        },
        {
          _id: missingActor._id,
          group: groupId,
          type: 'expense_added',
          actor: null,
          createdAt: iso,
          metadata: { expenseId, description: 'Dinner', amount: 12.34, currency: 'INR' },
        },
      ],
      pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
    });
  });

  it('reads one Expense history page', () => {
    expect(parseActivityPage(activityPage([event], 2), groupId, 2, expenseId).events).toHaveLength(
      1,
    );
  });

  type ActivityResponse = ReturnType<typeof activityPage>;
  const first = (body: ActivityResponse) => body.data.activities[0];
  const rejections: [string, number, string | undefined, (body: ActivityResponse) => void][] = [
    ['a 50-row page', 1, undefined, (body: ActivityResponse) => (body.data.pagination.limit = 50)],
    ['another page', 2, undefined, () => undefined],
    ['another Group', 1, undefined, (body: ActivityResponse) => (first(body).group = otherGroup)],
    ['another Expense', 1, 'c00000000000000000000009', () => undefined],
    [
      'a historical currency',
      1,
      undefined,
      (body: ActivityResponse) => (first(body).metadata!.currency = 'DEM'),
    ],
    [
      'an inexact amount',
      1,
      undefined,
      (body: ActivityResponse) => (first(body).metadata!.amount = 12.345),
    ],
    ['an empty type', 1, undefined, (body: ActivityResponse) => (first(body).type = '')],
    ['a wrong status', 1, undefined, (body: ActivityResponse) => (body.status = 500)],
  ];
  it.each(rejections)('rejects %s', (_label, page, expense, change) => {
    const body = clone(activityPage());
    change(body);
    expect(() => parseActivityPage(body, groupId, page, expense)).toThrow();
  });
});

const record = {
  ...expense,
  revision: 2,
  tag: 'Shared',
  tagId: 'd00000000000000000000001',
  notes: '',
  isDeleted: false,
  createdBy: person,
  editHistory: [{ editedBy: priya, editedAt: iso, changes: { amount: { old: 8, new: 10 } } }],
  receiptUrl: null,
  extra: 'kept on the wire',
};

describe('parseExpenseRecord', () => {
  it('returns the record as the saved-draft schema reads it', () => {
    const parsed = parseExpenseRecord({ status: 200, data: clone(record) }, groupId, expenseId);
    expect(parsed).toStrictEqual(expenseRecordSchema.parse(clone(record)));
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.paidBy).toStrictEqual([
      { user: sam, name: 'Sam Chen', amount: 10, amountMinor: 1000 },
    ]);
    expect(parsed.splitBetween[1]).toStrictEqual({
      user: null,
      name: 'Former member',
      amount: 5,
      amountMinor: 500,
    });
  });

  type RecordResponse = Partial<typeof record>;
  it.each([
    ['another Group', (body: RecordResponse) => (body.group = otherGroup)],
    ['another Expense', (body: RecordResponse) => (body._id = 'c00000000000000000000009')],
    ['a historical currency', (body: RecordResponse) => (body.currency = 'DEM')],
    ['unbalanced money', (body: RecordResponse) => (body.amountMinor = 999)],
    ['a negative revision', (body: RecordResponse) => (body.revision = -1)],
    ['a missing deleted flag', (body: RecordResponse) => delete body.isDeleted],
  ])('rejects %s', (_label, change) => {
    const body = clone(record);
    change(body);
    expect(() => parseExpenseRecord({ status: 200, data: body }, groupId, expenseId)).toThrow();
  });
});
