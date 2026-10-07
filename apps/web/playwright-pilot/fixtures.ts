import { expect, type Page, type TestInfo } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { DEMO_GROUP_ID, DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import type { UserBalancesResponse } from '@splitbook/shared/types';

export const FIXED_TIME = '2026-09-06T09:00:00.000Z';
const alex = { _id: DEMO_PERSONA_IDS.alex, name: 'Alex Rivera', email: 'alex@example.com' };
const sam = { _id: DEMO_PERSONA_IDS.sam, name: 'Sam Chen', email: 'sam@example.com' };
export const group = {
  _id: DEMO_GROUP_ID,
  name: 'Goa Friends Trip',
  category: 'trip',
  defaultCurrency: 'INR',
  alternateCurrencies: [],
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2026-09-10T00:00:00.000Z',
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  createdBy: alex._id,
  inviteCode: 'sample-goa-trip',
  members: [
    { user: alex, role: 'admin', joinedAt: FIXED_TIME },
    { user: sam, role: 'member', joinedAt: FIXED_TIME },
  ],
  tags: [
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Food', isArchived: false, createdAt: FIXED_TIME },
  ],
};
const summary: UserBalancesResponse = {
  buckets: [{ currency: 'INR', youOwe: 1480, youAreOwed: 0, net: -1480 }],
  hasMixedCurrencies: false,
  groups: [
    {
      groupId: DEMO_GROUP_ID,
      name: group.name,
      category: 'trip',
      updatedAt: FIXED_TIME,
      hasMixedCurrencies: false,
      balances: [
        {
          currency: 'INR',
          balance: -1480,
          settlement: { counterpartyId: sam._id, counterpartyName: sam.name, amount: 1480 },
        },
      ],
    },
  ],
  suggestedPayments: [
    {
      groupId: DEMO_GROUP_ID,
      groupName: group.name,
      currency: 'INR',
      direction: 'pay',
      counterpartyId: sam._id,
      counterpartyName: sam.name,
      amountMinor: 148_000,
    },
  ],
};
/** A member in no Group with an open balance: nothing owed, nothing to pay or receive. */
export const settledSummary: UserBalancesResponse = {
  buckets: [],
  groups: [],
  hasMixedCurrencies: false,
  suggestedPayments: [],
};
/** Home's spending read (#307): six Months to the fixed time in Asia/Kolkata, the Goa trip only. */
const spending = {
  timeZone: 'Asia/Kolkata',
  months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  window: { from: '2026-04-01', to: '2026-09-30' },
  groups: [{ groupId: DEMO_GROUP_ID, name: group.name }],
  currencies: [
    {
      currency: 'INR',
      totalMinor: 416000,
      expenseCount: 4,
      months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((month) => {
        const shareMinor = month === '2026-08' ? 120000 : month === '2026-09' ? 296000 : 0;
        return {
          month,
          shareMinor,
          byGroup: shareMinor ? [{ groupId: DEMO_GROUP_ID, shareMinor }] : [],
        };
      }),
    },
  ],
  // #308: September by Category (Alex's ₹2,960.00) and what the trip spent; its last change is
  // the dinner's correction in Latest changes.
  thisMonth: {
    month: '2026-09',
    byCategory: [
      {
        currency: 'INR',
        totalMinor: 296000,
        expenseCount: 3,
        categories: [
          { category: 'food', shareMinor: 125000, expenseCount: 1 },
          { category: 'accommodation', shareMinor: 120000, expenseCount: 1 },
          { category: 'transport', shareMinor: 51000, expenseCount: 1 },
        ],
      },
    ],
    groups: [
      {
        groupId: DEMO_GROUP_ID,
        spent: [{ currency: 'INR', totalMinor: 592000, expenseCount: 3 }],
      },
    ],
  },
  lastChanges: [{ groupId: DEMO_GROUP_ID, at: '2026-09-06T08:40:00.000Z' }],
};
export const groupBalances = {
  balances: [
    { user: alex, balance: -1480 },
    { user: sam, balance: 1480 },
  ],
  debts: [{ from: alex, to: sam, amount: 1480 }],
  currency: 'INR',
  hasMixedCurrencies: false,
};

/** Home's latest changes (#309): the trip's dinner, entered, then corrected. */
const latestChanges = {
  limit: 10,
  activities: [
    {
      _id: 'e00000000000000000000002',
      type: 'expense_updated',
      createdAt: '2026-09-06T08:40:00.000Z',
      group: { _id: DEMO_GROUP_ID, name: group.name },
      actor: { _id: sam._id, name: sam.name },
      currency: 'INR',
      metadata: {
        expenseId: 'c00000000000000000000001',
        description: 'Beach shack dinner',
        changes: { amount: { old: 2400, new: 2500 }, amountMinor: { old: 240000, new: 250000 } },
      },
    },
    {
      _id: 'e00000000000000000000001',
      type: 'expense_added',
      createdAt: '2026-09-05T15:30:00.000Z',
      group: { _id: DEMO_GROUP_ID, name: group.name },
      actor: { _id: alex._id, name: alex.name },
      currency: 'INR',
      metadata: {
        expenseId: 'c00000000000000000000001',
        description: 'Beach shack dinner',
        amount: 2400,
        currency: 'INR',
      },
    },
  ],
};

/** Fixture only public HTTP responses; real demo authentication stays in place. */
export async function installPilotFixtures(page: Page, overrides: Record<string, unknown> = {}) {
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  const responses: Record<string, unknown> = {
    '/api/groups': [group],
    '/api/user/balances': summary,
    '/api/user/activity': latestChanges,
    '/api/user/spending': spending,
    '/api/invitations': [],
    [`/api/groups/${DEMO_GROUP_ID}`]: group,
    [`/api/groups/${DEMO_GROUP_ID}/balances`]: groupBalances,
    [`/api/groups/${DEMO_GROUP_ID}/settlements`]: [
      {
        _id: 'sample-settlement',
        paidBy: alex,
        paidTo: sam,
        amount: 100,
        currency: 'INR',
        note: 'Dinner contribution',
        createdAt: FIXED_TIME,
        createdBy: alex,
      },
    ],
    [`/api/groups/${DEMO_GROUP_ID}/expenses`]: {
      expenses: [],
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
      summary: { totalAmount: 2500, count: 1, byCategory: [], byMember: [] },
    },
    ...overrides,
  };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET' && pathname in responses) {
      await route.fulfill({ json: { status: 200, data: responses[pathname] } });
    } else await route.continue();
  });
}

export async function expectAccessible(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  await testInfo.attach('accessibility', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({
        id: v.id,
        nodes: v.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      })),
  ).toEqual([]);
}
