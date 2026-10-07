import { MongoClient, ObjectId } from 'mongodb';
import type { Page, Response } from '@playwright/test';
import { test, expect, dataOf, type Ledger } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { toPeriod } from '@splitbook/shared/recurring-due-periods';

// #240: the Group page starts its Group, Expense count and Balances reads together. The first
// two materialize due recurring Expenses; Balances must too, or the page shows last month's
// figures beside this month's Rent until a poll.

/**
 * Priya's ₹30,000 Rent, split equally with Sam, created through the API and then rewound one
 * month in storage: last month's Rent exists, and this month's is due but not yet read.
 */
async function rentDueThisMonth(ledger: Ledger) {
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const template = await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/recurring`, {
      data: {
        description: 'Flat rent',
        amount: 30000,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 30000 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.priya }, { user: DEMO_PERSONA_IDS.sam }],
        dayOfMonth: 1,
        startsOn: thisMonth.toISOString(),
      },
    }),
    201,
  );
  const dbName = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!dbName || !/^splitbook-test-access-[a-f0-9-]+$/.test(dbName))
    throw new Error('Unique isolated test database required');
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    const db = client.db(dbName);
    const rewound = await db
      .collection('expenses')
      .updateOne(
        { recurringExpense: new ObjectId(template._id), period: toPeriod(thisMonth) },
        { $set: { period: toPeriod(lastMonth), date: lastMonth } },
      );
    expect(rewound.modifiedCount).toBe(1);
    await db
      .collection('recurringexpenses')
      .updateOne(
        { _id: new ObjectId(template._id) },
        { $set: { startsOn: lastMonth, lastGeneratedFor: toPeriod(lastMonth) } },
      );
  } finally {
    await client.close();
  }
  return template._id as string;
}

async function rentRows(ledger: Ledger, templateId: string) {
  const list = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
  return list.expenses.filter(
    (row: { recurringExpense?: string }) => row.recurringExpense === templateId,
  );
}

/**
 * Enter as Sam once the Group page's own reads have answered, counting its Balances reads.
 * `balancesFirst` holds the reads that materialize (Group and Expenses) until the Balances read
 * has answered, so Balances is computed before anything else can materialize the Rent. Without
 * the hold, a slow first route compile can let the Group read win and hide a stale Balances read.
 */
async function openAsSam(
  page: Page,
  ledger: Ledger,
  { query = '', balancesFirst = false }: { query?: string; balancesFirst?: boolean } = {},
) {
  const baseURL = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL))
    throw new Error('Isolated app required');
  const groupPath = `/api/groups/${ledger.groupB}`;
  const balanceReads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `${groupPath}/balances`)
      balanceReads.push(request.url());
  });
  if (balancesFirst) {
    let releaseReads!: () => void;
    const balancesAnswered = new Promise<void>((resolve) => (releaseReads = resolve));
    page.on('response', (response) => {
      if (
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === `${groupPath}/balances`
      )
        releaseReads();
    });
    await page.route(
      (url) => url.pathname === groupPath || url.pathname === `${groupPath}/expenses`,
      async (route) => {
        if (route.request().method() === 'GET') await balancesAnswered;
        await route.fallback();
      },
    );
  }
  const answered = (matches: (url: URL) => boolean) =>
    page.waitForResponse(
      (response: Response) =>
        response.request().method() === 'GET' && matches(new URL(response.url())),
    );
  // Route compilation can outlast the UI assertion budget; observe before navigating.
  const loaded = Promise.all([
    answered((url) => url.pathname === groupPath),
    answered(
      (url) => url.pathname === `${groupPath}/expenses` && url.searchParams.get('limit') === '1',
    ),
    answered((url) => url.pathname === `${groupPath}/balances`),
  ]);
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(`${baseURL}/groups/${ledger.groupB}${query}`);
  for (const response of await loaded) {
    expect(response.status()).toBe(200);
    await response.finished();
  }
  return balanceReads;
}

test('opening a Household shows Balances with the recurring Rent the same visit materialized', async ({
  page,
  ledger,
}) => {
  const templateId = await rentDueThisMonth(ledger);

  // The Household's own balance shows on its Balances tab (#305). The tab's own Balances read
  // may follow the page's first one, so the first answer itself must already hold the Rent.
  const firstBalances = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/groups/${ledger.groupB}/balances`,
  );
  const balanceReads = await openAsSam(page, ledger, { balancesFirst: true, query: '/balances' });

  const first = await (await firstBalances).json();
  expect(
    first.data.balances.find(
      (row: { user: { _id: string } }) => row.user._id === DEMO_PERSONA_IDS.sam,
    ).balance,
  ).toBe(-30000);
  const own = page.getByRole('region', { name: 'All-time balance', exact: true });
  await expect(own).toContainText('30,000.00');
  await expect(own).toContainText('You owe');
  expect(balanceReads.length).toBeGreaterThanOrEqual(1);
  expect(await rentRows(ledger, templateId)).toHaveLength(2);
});

test('the Balances tab debt and the Record payment prefill include this month’s Rent', async ({
  page,
  ledger,
}) => {
  const templateId = await rentDueThisMonth(ledger);

  await openAsSam(page, ledger, { query: '?tab=balances' });

  const debts = page.getByRole('region', { name: 'Settle up', exact: true });
  await expect(debts.getByText('₹30,000.00', { exact: true })).toBeVisible();
  await debts.getByRole('button', { name: /^Record .*payment to/ }).click();
  const form = page.getByRole('region', { name: 'Record payment', exact: true });
  await expect(form.getByRole('textbox', { name: 'Amount paid' })).toHaveValue('30000.00');
  // Inspect the prefill only; nothing is recorded.
  expect(await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/settlements`))).toEqual(
    [],
  );
  expect(await rentRows(ledger, templateId)).toHaveLength(2);
});
