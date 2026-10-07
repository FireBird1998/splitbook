import {
  test as base,
  expect,
  request,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';
import { DEMO_PERSONA_IDS, type DemoPersonaKey } from '../src/lib/demo-personas';

/** The top bar's Add expense (#304): labelled on desktop, an icon button of the same name on phones. */
export const addExpenseButton = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: 'Add expense', exact: true });

/**
 * Open Add expense from the top bar and return the dialog it opens: inside a Group, the Group's
 * Expense form; elsewhere pass the chooser. A click that lands before the page hydrates does
 * nothing, so it clicks until the dialog opens.
 */
export async function openAddExpense(
  page: Page,
  dialog: Locator = page.getByRole('dialog', { name: /^Add expense/ }),
): Promise<Locator> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await addExpenseButton(page).click({ timeout: 1_000 });
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return dialog;
}

export async function dataOf(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()).data;
}

/** Enter as a demo persona through the Better Auth plugin endpoint; the context keeps the session cookie. */
async function login(baseURL: string, persona: DemoPersonaKey) {
  const context = await request.newContext({ baseURL });
  const entered = await context.post('/api/auth/demo-persona/sign-in', {
    data: { personaId: persona },
  });
  expect(entered.status(), await entered.text()).toBe(200);
  const session = await (await context.get('/api/auth/get-session')).json();
  expect(session?.user?.id).toBe(DEMO_PERSONA_IDS[persona]);
  return context;
}

export async function joinGroup(
  owner: APIRequestContext,
  member: APIRequestContext,
  groupId: string,
) {
  const invite = await dataOf(
    await owner.post(`/api/groups/${groupId}/invite-link`, { data: {} }),
    201,
  );
  await dataOf(await member.post(`/api/join/${invite.inviteCode}`), 201);
}

export const expensePath = (group: string, expense: string) =>
  `/api/groups/${group}/expenses/${expense}`;

/** Read the version before an authorized mutation; contexts remain unmodified. */
export async function expenseRevisionHeaders(actor: APIRequestContext, path: string) {
  const expense = await dataOf(await actor.get(path));
  return { 'X-Splitbook-Revision': String(expense.revision ?? 0) };
}

export type Ledger = {
  alex: APIRequestContext;
  sam: APIRequestContext;
  priya: APIRequestContext;
  anonymous: APIRequestContext;
  groupA: string;
  groupB: string;
  expenseA: string;
  expenseB: string;
};

export const test = base.extend<{ ledger: Ledger }>({
  ledger: async ({}, provideLedger) => {
    const baseURL = process.env.EXPENSE_ACCESS_BASE_URL;
    if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL))
      throw new Error('Run with isolated expense-access config');
    const alex = await login(baseURL, 'alex');
    const sam = await login(baseURL, 'sam');
    const priya = await login(baseURL, 'priya');
    const anonymous = await request.newContext({ baseURL });
    try {
      const groupBody = {
        name: 'Synthetic access household',
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      };
      const groupA = (await dataOf(await alex.post('/api/groups', { data: groupBody }), 201))._id;
      const groupB = (await dataOf(await priya.post('/api/groups', { data: groupBody }), 201))._id;
      await joinGroup(priya, sam, groupB);
      const create = async (owner: APIRequestContext, group: string, payer: string) =>
        dataOf(
          await owner.post(`/api/groups/${group}/expenses`, {
            data: {
              description: 'Private rent',
              amount: 1200,
              currency: 'INR',
              category: 'housing',
              tag: 'Rent',
              date: new Date().toISOString(),
              paidBy: [{ user: payer, amount: 1200 }],
              splitMethod: 'equal',
              splitBetween: [{ user: payer }],
            },
          }),
          201,
        );
      const expenseA = (await create(alex, groupA, DEMO_PERSONA_IDS.alex))._id;
      const expenseB = (await create(priya, groupB, DEMO_PERSONA_IDS.priya))._id;
      await provideLedger({ alex, sam, priya, anonymous, groupA, groupB, expenseA, expenseB });
    } finally {
      await Promise.all([alex, sam, priya, anonymous].map((context) => context.dispose()));
    }
  },
});

export { expect };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The button that opens an Expense in a Group's list (#310): a row's description in the table
 * on a computer, or the whole card on a phone. Its name starts with the description.
 */
export function expenseButton(page: Page, description: string) {
  return page
    .getByRole('main')
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(description)}(\\s|$)`) });
}

/**
 * An Expense in the list, row or card, to read its amount and position from. It holds the
 * button that opens it.
 */
export function expenseInList(page: Page, description: string) {
  const named = { name: new RegExp(`^${escapeRegExp(description)}(\\s|$)`) };
  return page
    .getByRole('main')
    .locator('[data-expense-id]')
    .filter({ has: page.getByRole('button', named) });
}

/**
 * Open an Expense in the list and press Edit or Delete in its details: the side panel on a
 * computer (#311), whose Delete reads "Delete Expense", or below the card on a phone.
 */
export async function expenseAction(page: Page, description: string, action: 'Edit' | 'Delete') {
  const opener = expenseButton(page, description);
  if ((await opener.getAttribute('aria-expanded')) !== 'true') await opener.click();
  await page
    .getByRole('region', { name: `${description} details` })
    .getByRole('button', { name: action === 'Delete' ? /^Delete( Expense)?$/ : /^Edit$/ })
    .click();
}

/** Generate through the existing template request, rather than faking origin metadata. */
export async function generatedExpense(ledger: Ledger): Promise<string> {
  const now = new Date();
  const startsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const template = await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/recurring`, {
      data: {
        description: 'Generated rent',
        amount: 1200,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 1200 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.priya }],
        dayOfMonth: 1,
        startsOn,
      },
    }),
    201,
  );
  const list = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/expenses`));
  const expense = list.expenses.find(
    (item: { recurringExpense: string }) => item.recurringExpense === template._id,
  );
  expect(expense).toMatchObject({ description: 'Generated rent', amount: 1200, isDeleted: false });
  return expense._id;
}

export async function observeLedger(ledger: Ledger, expense: string) {
  return {
    expense: await dataOf(await ledger.priya.get(expensePath(ledger.groupB, expense))),
    activityA: await dataOf(await ledger.alex.get(`/api/groups/${ledger.groupA}/activity`)),
    activityB: await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/activity`)),
  };
}
