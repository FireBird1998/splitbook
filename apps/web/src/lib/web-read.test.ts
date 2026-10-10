import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  homeBalancesKey,
  expensePageKey,
  expenseRecordKey,
  groupBalancesKey,
  activityPageKey,
  queryKeyPath,
} from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from './web-query-keys';
import {
  fetchWebHomeBalances,
  fetchWebExpensePage,
  fetchWebExpenseRecord,
  fetchWebBalances,
  fetchWebActivity,
} from './web-read';

const group = 'a'.repeat(24),
  id = 'b'.repeat(24),
  person = { _id: 'c'.repeat(24), name: 'Legacy member' };
const timestamp = '2026-10-01T00:00:00.000Z';
const expense = {
  _id: id,
  group,
  description: 'Fictional legacy lunch',
  amount: 12,
  currency: 'XYZ',
  date: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  category: 'food',
  splitMethod: 'equal',
  paidBy: [{ user: person, amount: 12 }],
  splitBetween: [{ user: person, amount: 12 }],
};
const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
const page = {
  status: 200,
  data: {
    expenses: [expense],
    pagination,
    summary: {
      count: 9,
      totalsByCurrency: [{ currency: 'XYZ', totalAmount: 12 }],
      totalAmount: 12,
      userOwes: 0,
      userGetsBack: 0,
    },
  },
};
const balances = {
  status: 200,
  data: {
    currency: 'XYZ',
    balances: [],
    debts: [],
    byCurrency: [
      {
        currency: 'XYZ',
        balances: [{ user: person, balance: 12 }],
        debts: [{ from: person, to: person, amount: 12 }],
      },
    ],
  },
};
const account = WEB_QUERY_ACCOUNT;
const cases = [
  [
    'Home totals',
    fetchWebHomeBalances,
    homeBalancesKey(account),
    { status: 200, data: { buckets: [{ currency: 'XYZ', youOwe: 1, youAreOwed: 2 }] } },
  ],
  ['trip total', fetchWebExpensePage, expensePageKey(account, group, { page: 1, limit: 1 }), page],
  [
    'Household month',
    fetchWebExpensePage,
    expensePageKey(account, group, { page: 1, limit: 1, dateFrom: timestamp }),
    page,
  ],
  [
    'Expense list',
    fetchWebExpensePage,
    expensePageKey(account, group, { page: 1, limit: 50 }),
    page,
  ],
  ['header Balances', fetchWebBalances, groupBalancesKey(account, group), balances],
  ['Balances tab', fetchWebBalances, groupBalancesKey(account, group), balances],
  [
    'Expense record',
    fetchWebExpenseRecord,
    expenseRecordKey(account, group, id),
    { status: 200, data: { ...expense, revision: 0, isDeleted: false } },
  ],
  [
    'Activity',
    fetchWebActivity,
    activityPageKey(account, group, { page: 1, limit: 50 }),
    {
      status: 200,
      data: {
        activities: [
          {
            _id: id,
            group,
            type: 'expense_added',
            actor: person,
            createdAt: timestamp,
            metadata: { amount: 12, currency: 'XYZ' },
          },
        ],
        pagination,
      },
    },
  ],
] as const;
afterEach(() => vi.unstubAllGlobals());

describe('the eight decoded web reads (#235)', () => {
  it.each(cases)(
    '%s keeps legacy wire data and fetches its key’s path',
    async (_, read, key, fixture) => {
      const fetch = vi.fn().mockResolvedValue(Response.json(fixture));
      vi.stubGlobal('fetch', fetch);
      expect(await read(key)).toEqual(fixture);
      expect(fetch.mock.calls[0][0]).toBe(queryKeyPath(key));
    },
  );
  it.each(cases)('%s rejects malformed data without echoing its text', async (_, read, key) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 200, data: { private: 'DO NOT DISCLOSE' } })),
    );
    await expect(read(key)).rejects.toThrow(/Unable to load/);
    try {
      await read(key);
    } catch (error) {
      expect(String(error)).not.toContain('DO NOT DISCLOSE');
    }
  });
});
