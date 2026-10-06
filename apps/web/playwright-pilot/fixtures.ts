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
