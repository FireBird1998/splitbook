import type { APIRequestContext, Page } from '@playwright/test';
import {
  test,
  expect,
  dataOf,
  expensePath,
  expenseAction,
  expenseButton,
  expenseInList,
} from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

type Write = { method: string; path: string; revision?: string; ifMatch?: string };

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

/**
 * Staging's host read If-Match as an HTTP precondition: the route saved the change, then the host
 * answered 412 in its place (#186). This host does the same, and records the revision headers of
 * every edit and deletion the page sends for the Group.
 */
async function enterBehindHostThatReadsIfMatch(
  page: Page,
  actor: APIRequestContext,
  groupId: string,
  path: string,
) {
  const writes: Write[] = [];
  await page.route(`**/api/groups/${groupId}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    if (method !== 'PATCH' && method !== 'DELETE') return route.fallback();
    const headers = await request.allHeaders();
    writes.push({
      method,
      path: new URL(request.url()).pathname,
      revision: headers['x-splitbook-revision'],
      ifMatch: headers['if-match'],
    });
    const response = await route.fetch();
    if (headers['if-match'] !== undefined)
      return route.fulfill({ status: 412, body: 'Precondition Failed' });
    return route.fulfill({ response });
  });
  await page.context().addCookies((await actor.storageState()).cookies);
  await page.goto(appURL(path));
  return writes;
}

test('the web app edits, deletes and restores an Expense with X-Splitbook-Revision', async ({
  page,
  ledger,
}) => {
  const path = expensePath(ledger.groupB, ledger.expenseB);
  const writes = await enterBehindHostThatReadsIfMatch(
    page,
    ledger.priya,
    ledger.groupB,
    `/groups/${ledger.groupB}`,
  );

  await expect(expenseInList(page, 'Private rent')).toContainText('₹1,200.00');
  await expenseAction(page, 'Private rent', 'Edit');
  const form = page.getByRole('dialog');
  await form.getByLabel('What was it for?').fill('Corrected rent');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(form).toBeHidden();

  const corrected = expenseButton(page, 'Corrected rent');
  await expect(expenseInList(page, 'Corrected rent')).toContainText('₹1,200.00');
  await expenseAction(page, 'Corrected rent', 'Delete');
  const confirm = page.getByRole('dialog', { name: 'Delete Expense' });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(corrected).toBeHidden();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(corrected).toBeVisible();

  expect(writes).toEqual([
    { method: 'PATCH', path, revision: '0', ifMatch: undefined },
    { method: 'DELETE', path, revision: '1', ifMatch: undefined },
    { method: 'PATCH', path, revision: '2', ifMatch: undefined },
  ]);
  expect(await dataOf(await ledger.priya.get(path))).toMatchObject({
    description: 'Corrected rent',
    isDeleted: false,
    revision: 3,
  });
});

test('the web app edits, pauses and deletes a recurring Expense with X-Splitbook-Revision', async ({
  page,
  ledger,
}) => {
  const now = new Date();
  const list = `/api/groups/${ledger.groupB}/recurring`;
  const template = await dataOf(
    await ledger.priya.post(list, {
      data: {
        description: 'Recurring header fixture',
        amount: 100,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 100 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.priya }, { user: DEMO_PERSONA_IDS.sam }],
        dayOfMonth: 1,
        startsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      },
    }),
    201,
  );
  const path = `${list}/${template._id}`;
  const writes = await enterBehindHostThatReadsIfMatch(
    page,
    ledger.priya,
    ledger.groupB,
    `/groups/${ledger.groupB}/settings`,
  );
  const actions = (description: string) =>
    page.getByRole('button', { name: `Actions for recurring expense ${description}` });

  await actions('Recurring header fixture').click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit recurring expense' });
  await form.getByLabel('Description').fill('Recurring header corrected');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(form).toBeHidden();

  await actions('Recurring header corrected').click();
  await page.getByRole('menuitem', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();

  await actions('Recurring header corrected').click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete recurring expense' });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(actions('Recurring header corrected')).toBeHidden();

  expect(writes).toEqual([
    { method: 'PATCH', path, revision: '0', ifMatch: undefined },
    { method: 'PATCH', path, revision: '1', ifMatch: undefined },
    { method: 'DELETE', path, revision: '2', ifMatch: undefined },
  ]);
  const templates = await dataOf(await ledger.priya.get(list));
  expect(templates.some((row: { _id: string }) => row._id === template._id)).toBe(false);
});
