import type { APIRequestContext, BrowserContext, Page, Route } from '@playwright/test';
import { test, expect, dataOf, joinGroup, type Ledger } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

/*
 * #198: a payment whose reply was lost is stored in the browser before its
 * first send, with its Idempotency-Key and exact body, and is only ever sent
 * again unchanged, by an explicit Save. Modelled on ledger-recovery-ui.spec.ts.
 */

const ALEX = DEMO_PERSONA_IDS.alex;
const SAM = DEMO_PERSONA_IDS.sam;
const PRIYA = DEMO_PERSONA_IDS.priya;
const ATTEMPT_PREFIX = 'splitbook:settlement-attempt:v1:';

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

const balancesURL = (ledger: Ledger) => appURL(`/groups/${ledger.groupB}?tab=balances`);

/** `payer` paid `amount` for `debtor` alone in Group B, so the debtor owes the payer all of it. */
async function owes(ledger: Ledger, payer: 'priya' | 'sam', debtor: string, amount: number) {
  await dataOf(
    await ledger[payer].post(`/api/groups/${ledger.groupB}/expenses`, {
      data: {
        description: `Synthetic purchase for ${amount}`,
        amount,
        currency: 'INR',
        category: 'other',
        tag: 'Rent',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS[payer], amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: debtor }],
      },
    }),
    201,
  );
}

type StoredAttempt = {
  entry: string;
  accountId: string;
  groupId: string;
  key: string;
  body: string;
};

/** The attempts this browser holds, read straight from localStorage. */
async function storedAttempts(page: Page): Promise<StoredAttempt[]> {
  return page.evaluate(
    (prefix) =>
      Object.keys(localStorage)
        .filter((entry) => entry.startsWith(prefix))
        .sort()
        .map((entry) => ({ entry, ...JSON.parse(localStorage.getItem(entry)!) })),
    ATTEMPT_PREFIX,
  );
}

/**
 * How one settlement POST is answered: `lose` commits it and drops the reply,
 * `pass` lets it through, and a status answers without reaching the server.
 */
type Answer = 'lose' | 'pass' | { status: number; error: string };
type Post = { key: string; body: string; storedBeforeSend: StoredAttempt[] };

/** Records every settlement POST any tab of the browser sends, answering the nth with `answers[n]`. */
async function settlementPosts(context: BrowserContext, ledger: Ledger, answers: Answer[]) {
  const posts: Post[] = [];
  await context.route(`**/api/groups/${ledger.groupB}/settlements`, async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const storedBeforeSend = await storedAttempts(request.frame().page());
    posts.push({
      key: request.headers()['idempotency-key'],
      body: request.postData() ?? '',
      storedBeforeSend,
    });
    const answer = answers[posts.length - 1] ?? 'pass';
    if (answer === 'pass') return route.continue();
    if (answer === 'lose') {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.abort('failed');
    }
    return route.fulfill({ status: answer.status, json: { error: answer.error } });
  });
  return posts;
}

async function openBalancesAsSam(page: Page, ledger: Ledger) {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(balancesURL(ledger));
}

function settleDialog(page: Page) {
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Record settlement', exact: true }),
  });
  return {
    dialog,
    amount: dialog.getByRole('spinbutton', { name: 'Amount' }),
    note: dialog.getByLabel('Note (optional)'),
    save: dialog.getByRole('button', { name: 'Save settlement', exact: true }),
    cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
  };
}

const recordSettlement = (page: Page) =>
  page.getByRole('button', { name: 'Record settlement', exact: true });
const checkPayment = (page: Page) =>
  page.getByRole('button', { name: 'Check payment', exact: true });

/** The suggested payment row naming `name`, for Groups with more than one suggestion. */
const debtRow = (page: Page, name: string) =>
  page
    .locator('div')
    .filter({ hasText: name })
    .filter({ has: recordSettlement(page) })
    .last();

/** Sam enters a payment on the first suggested row and saves it; its reply is lost. */
async function loseFirstReply(page: Page, amount: string, note = 'Paid via UPI') {
  const { dialog, amount: amountField, note: noteField, save } = settleDialog(page);
  await recordSettlement(page).click();
  await amountField.fill(amount);
  await noteField.fill(note);
  await save.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
}

async function ledgerState(actor: APIRequestContext, ledger: Ledger) {
  const group = `/api/groups/${ledger.groupB}`;
  const settlements = await dataOf(await actor.get(`${group}/settlements`));
  const activity = await dataOf(await actor.get(`${group}/activity`));
  const balances = await dataOf(await actor.get(`${group}/balances`));
  return {
    settlements: settlements as Array<{ _id: string; amountMinor: number; note: string }>,
    recorded: (activity.activities as Array<{ type: string }>).filter(
      (event) => event.type === 'settlement_recorded',
    ).length,
    debts: balances.debts as Array<{ amount: number; from: { _id: string }; to: { _id: string } }>,
  };
}

/** Both POSTs carried one key and one body, and the Group holds the payment once. */
async function expectRecordedOnce(
  ledger: Ledger,
  posts: Post[],
  expected: { amountMinor: number; debts: unknown[] },
) {
  expect(posts).toHaveLength(2);
  expect(posts[0].key).toBeTruthy();
  expect(posts[1].key).toBe(posts[0].key);
  expect(posts[1].body).toBe(posts[0].body);
  const state = await ledgerState(ledger.sam, ledger);
  expect(state.settlements).toHaveLength(1);
  expect(state.settlements[0]).toMatchObject({ amountMinor: expected.amountMinor });
  expect(state.recorded).toBe(1);
  expect(state.debts).toEqual(expected.debts);
}

/** The attempt was in localStorage, under Sam and Group B, before the first POST left. */
function expectStoredBeforeFirstSend(ledger: Ledger, posts: Post[]) {
  expect(posts[0].storedBeforeSend).toEqual([
    expect.objectContaining({
      accountId: SAM,
      groupId: ledger.groupB,
      key: posts[0].key,
      body: posts[0].body,
    }),
  ]);
}

const samOwesPriya = (amount: number) => [
  expect.objectContaining({
    amount,
    from: expect.objectContaining({ _id: SAM }),
    to: expect.objectContaining({ _id: PRIYA }),
  }),
];

test('(a) Cancel, then Record settlement and Save, resends the payment whose reply was lost', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  const posts = await settlementPosts(page.context(), ledger, ['lose']);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '250.25');
  const { dialog, save, cancel } = settleDialog(page);
  await cancel.click();
  await expect(dialog).toBeHidden();

  await recordSettlement(page).click();
  await save.click();
  await expect(dialog).toBeHidden();

  await expectRecordedOnce(ledger, posts, { amountMinor: 25025, debts: samOwesPriya(749.75) });
  expectStoredBeforeFirstSend(ledger, posts);
  expect(await storedAttempts(page)).toEqual([]);
});

test('(b) after paying the whole debt and reloading, Balances still offers the payment to save', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  const posts = await settlementPosts(page.context(), ledger, ['lose']);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '1000');

  await page.reload();
  // The committed payment cleared the debt, so nothing is suggested any more.
  await expect(page.getByText('Net positions', { exact: true })).toBeVisible();
  await expect(recordSettlement(page)).toHaveCount(0);
  await expect(checkPayment(page)).toBeVisible();
  await checkPayment(page).click();
  const { dialog, save } = settleDialog(page);
  await save.click();
  await expect(dialog).toBeHidden();

  await expectRecordedOnce(ledger, posts, { amountMinor: 100000, debts: [] });
  expectStoredBeforeFirstSend(ledger, posts);
  expect(await storedAttempts(page)).toEqual([]);
});

test('(c) a second tab of the same browser offers the payment and saves it under the same key', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  const posts = await settlementPosts(page.context(), ledger, ['lose']);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '250.25');

  const second = await page.context().newPage();
  await second.goto(balancesURL(ledger));
  await expect(checkPayment(second)).toBeVisible();
  await checkPayment(second).click();
  expect(posts).toHaveLength(1); // Opening the tab and the dialog sent nothing.
  const { dialog, save } = settleDialog(second);
  await save.click();
  await expect(dialog).toBeHidden();

  await expectRecordedOnce(ledger, posts, { amountMinor: 25025, debts: samOwesPriya(749.75) });
  expect(await storedAttempts(second)).toEqual([]);
});

for (const opened of ['record', 'check'] as const) {
  test(`once another tab confirms the payment, this tab's open dialog sends nothing (${opened})`, async ({
    page,
    ledger,
  }) => {
    await owes(ledger, 'priya', SAM, 1000);
    const posts = await settlementPosts(page.context(), ledger, ['lose']);
    await openBalancesAsSam(page, ledger);
    await loseFirstReply(page, '250.25');
    const here = settleDialog(page);
    if (opened === 'check') {
      // Opened again from the stored payment rather than kept open from the first Save.
      await here.cancel.click();
      await expect(here.dialog).toBeHidden();
      await checkPayment(page).click();
    }
    await expect(here.amount).not.toBeEditable();

    const other = await page.context().newPage();
    await other.goto(balancesURL(ledger));
    await checkPayment(other).click();
    const there = settleDialog(other);
    await there.save.click();
    await expect(there.dialog).toBeHidden();
    expect(posts).toHaveLength(2);

    // This tab hears the payment is gone. Its dialog must not turn into a new payment.
    await expect(here.dialog).toContainText('confirmed or discarded in another tab');
    if (await here.save.isEnabled()) {
      await here.save.click();
      await expect(here.dialog).toBeHidden();
    }
    expect(posts).toHaveLength(2);
    await expect(here.save).toBeDisabled();
    await expect(here.amount).toHaveValue('250.25');
    await expect(here.amount).not.toBeEditable();

    await here.cancel.click();
    await expect(here.dialog).toBeHidden();
    // Balances read again at once: the stored payment is gone and the debt fell once.
    await expect(checkPayment(page)).toHaveCount(0);
    await expect(page.getByText('₹749.75', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expectRecordedOnce(ledger, posts, { amountMinor: 25025, debts: samOwesPriya(749.75) });
  });
}

test('the payment survives Cancel, a Group tab switch, a reload and a closed window, and only Save sends it', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  const posts = await settlementPosts(page.context(), ledger, ['lose']);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '250.25', 'Rent share');
  await settleDialog(page).cancel.click();
  const pending = page.getByText(/Your payment of ₹250\.25 to Priya Shah may already be recorded/);
  await expect(pending).toBeVisible();

  const sections = page.getByRole('navigation', { name: 'Synthetic access household sections' });
  await sections.getByRole('link', { name: 'Expenses' }).click();
  await expect(pending).toBeHidden();
  await sections.getByRole('link', { name: 'Balances' }).click();
  await expect(pending).toBeVisible();

  await page.reload();
  await expect(pending).toBeVisible();

  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(balancesURL(ledger));
  await checkPayment(reopened).click();
  const shown = settleDialog(reopened);
  await expect(shown.amount).toHaveValue('250.25');
  await expect(shown.amount).not.toBeEditable();
  await expect(shown.note).toHaveValue('Rent share');
  await expect(shown.note).not.toBeEditable();
  await expect(shown.dialog).toContainText('This payment may already be recorded');
  expect(posts).toHaveLength(1);

  await shown.save.click();
  await expect(shown.dialog).toBeHidden();
  await expectRecordedOnce(ledger, posts, { amountMinor: 25025, debts: samOwesPriya(749.75) });
});

test('a stored payment blocks a different one between the same two members, either way, but not other pairs', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 500);
  const posts = await settlementPosts(page.context(), ledger, ['lose']);
  await openBalancesAsSam(page, ledger);
  // Sam overpays: once recorded, Priya owes Sam 100.
  await loseFirstReply(page, '600', 'Overpaid');
  const { dialog, amount, note, save, cancel } = settleDialog(page);
  await cancel.click();

  await joinGroup(ledger.priya, ledger.alex, ledger.groupB);
  await owes(ledger, 'sam', ALEX, 300);
  await page.reload();

  // The reverse suggestion between the same pair opens the earlier payment, read-only.
  await debtRow(page, 'Priya Shah').getByRole('button', { name: 'Record settlement' }).click();
  await expect(amount).toHaveValue('600');
  await expect(amount).not.toBeEditable();
  await expect(note).toHaveValue('Overpaid');
  await expect(note).not.toBeEditable();
  await expect(dialog).toContainText('isn’t confirmed yet, so it comes first');
  await cancel.click();
  expect(posts).toHaveLength(1);

  // Alex and Sam are another pair: their payment saves at once under its own key.
  await debtRow(page, 'Alex Rivera').getByRole('button', { name: 'Record settlement' }).click();
  await expect(amount).toBeEditable();
  await expect(amount).toHaveValue('300');
  await save.click();
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(2);
  expect(posts[1].key).not.toBe(posts[0].key);
  expect(JSON.parse(posts[1].body)).toMatchObject({ paidBy: ALEX, paidTo: SAM, amount: 300 });
  expect(await storedAttempts(page)).toEqual([
    expect.objectContaining({ key: posts[0].key, body: posts[0].body }),
  ]);

  // Confirming the earlier payment resends it as it was.
  await checkPayment(page).click();
  await save.click();
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(3);
  expect(posts[2]).toMatchObject({ key: posts[0].key, body: posts[0].body });
  const state = await ledgerState(ledger.sam, ledger);
  expect(state.settlements.map((row) => row.amountMinor).sort()).toEqual([30000, 60000]);
  expect(state.recorded).toBe(2);
  expect(state.debts).toEqual([
    expect.objectContaining({
      amount: 100,
      from: expect.objectContaining({ _id: PRIYA }),
      to: expect.objectContaining({ _id: SAM }),
    }),
  ]);
});

test('Discard is offered only after the dialog says to check the Group’s payments, and the next payment gets a new key', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  const posts = await settlementPosts(page.context(), ledger, ['lose']);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '250.25');
  const { dialog, amount, save, cancel } = settleDialog(page);
  await cancel.click();

  await checkPayment(page).click();
  const discard = dialog.getByRole('button', { name: 'Discard payment', exact: true });
  await expect(discard).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Discard this payment', exact: true }).click();
  await expect(dialog).toContainText('Check the Group’s payments first');
  await expect(dialog).toContainText('Settlement history');
  await discard.click();
  await expect(dialog).toBeHidden();
  expect(await storedAttempts(page)).toEqual([]);
  await expect(checkPayment(page)).toHaveCount(0);

  await recordSettlement(page).click();
  await expect(amount).toBeEditable();
  await amount.fill('100');
  await save.click();
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(2);
  expect(posts[1].key).toBeTruthy();
  expect(posts[1].key).not.toBe(posts[0].key);
  const state = await ledgerState(ledger.sam, ledger);
  expect(state.settlements.map((row) => row.amountMinor).sort()).toEqual([10000, 25025]);
});

test('a 4xx on a retry keeps the payment and shows why, and a later Save still sends the same key', async ({
  page,
  ledger,
}) => {
  await joinGroup(ledger.priya, ledger.alex, ledger.groupB);
  await owes(ledger, 'sam', ALEX, 300);
  const posts = await settlementPosts(page.context(), ledger, ['lose']);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '300');

  // The server rechecks both parties before it looks for the replay.
  await dataOf(await ledger.priya.delete(`/api/groups/${ledger.groupB}/members/${ALEX}`));
  const { dialog, amount, save } = settleDialog(page);
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Both payer and recipient must be group members',
  );
  await expect(amount).toHaveValue('300');
  await expect(amount).not.toBeEditable();
  expect(await storedAttempts(page)).toEqual([
    expect.objectContaining({ key: posts[0].key, body: posts[0].body }),
  ]);

  await joinGroup(ledger.priya, ledger.alex, ledger.groupB);
  await save.click();
  await expect(dialog).toBeHidden();
  expect(posts.map((post) => post.key)).toEqual([posts[0].key, posts[0].key, posts[0].key]);
  const state = await ledgerState(ledger.sam, ledger);
  expect(state.settlements).toHaveLength(1);
  expect(state.recorded).toBe(1);
  expect(await storedAttempts(page)).toEqual([]);
});

test('a 5xx keeps the payment, and Save sends it again under the same key', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  const posts = await settlementPosts(page.context(), ledger, [
    { status: 503, error: 'Synthetic outage' },
  ]);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '250.25');
  const { dialog, amount, save } = settleDialog(page);
  await expect(dialog.getByRole('alert')).toContainText('Synthetic outage');
  await expect(dialog).toContainText('This payment may already be recorded');
  await expect(dialog).not.toContainText('comes first'); // It is this dialog's own payment.
  await expect(amount).not.toBeEditable();
  expectStoredBeforeFirstSend(ledger, posts);
  expect(await storedAttempts(page)).toHaveLength(1);

  await save.click();
  await expect(dialog).toBeHidden();
  await expectRecordedOnce(ledger, posts, { amountMinor: 25025, debts: samOwesPriya(749.75) });
});

test('a 422 on the first send removes the payment and keeps the entries to correct', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  const posts = await settlementPosts(page.context(), ledger, ['pass']);
  await openBalancesAsSam(page, ledger);
  const tooLong = 'x'.repeat(501);
  await loseFirstReply(page, '250.25', tooLong);
  const { dialog, amount, note, save } = settleDialog(page);
  await expect(dialog.getByRole('alert')).toContainText('Validation error');
  expect(await storedAttempts(page)).toEqual([]);
  await expect(amount).toBeEditable();
  await expect(amount).toHaveValue('250.25');
  await expect(note).toHaveValue(tooLong);

  await note.fill('Paid via UPI');
  await save.click();
  await expect(dialog).toBeHidden();
  expect(posts).toHaveLength(2);
  expect(posts[1].key).not.toBe(posts[0].key);
  const state = await ledgerState(ledger.sam, ledger);
  expect(state.settlements).toEqual([expect.objectContaining({ amountMinor: 25025 })]);
});

test('sign-out removes every stored payment from the browser', async ({ page, ledger }) => {
  await owes(ledger, 'priya', SAM, 1000);
  await settlementPosts(page.context(), ledger, [{ status: 503, error: 'Synthetic outage' }]);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '250.25');
  await settleDialog(page).cancel.click();
  expect(await storedAttempts(page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  // A dev server may compile the landing page on this first visit.
  await expect(page).toHaveURL(appURL('/'), { timeout: 30_000 });
  expect(await storedAttempts(page)).toEqual([]);
});

test('another account signing in removes the previous account’s payments on its first page load', async ({
  page,
  ledger,
}) => {
  await owes(ledger, 'priya', SAM, 1000);
  await settlementPosts(page.context(), ledger, [{ status: 503, error: 'Synthetic outage' }]);
  await openBalancesAsSam(page, ledger);
  await loseFirstReply(page, '250.25');
  await settleDialog(page).cancel.click();
  expect(await storedAttempts(page)).toHaveLength(1);

  // A persona switch without signing out (as from a persona picker left open in another tab).
  // The same request the persona picker sends, with the Origin a browser adds.
  const switched = await page.context().request.post(appURL('/api/auth/demo-persona/sign-in'), {
    data: { personaId: 'priya' },
    headers: { Origin: new URL(appURL('/')).origin },
  });
  expect(switched.status(), await switched.text()).toBe(200);
  const other = await page.context().newPage();
  await page.close();
  await other.goto(appURL('/dashboard'));
  // Priya's Home: its heading, with Priya signed in at the foot of the sidebar.
  await expect(other.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
  await expect(
    other
      .getByRole('complementary', { name: 'Splitbook' })
      .getByRole('button', { name: 'Priya Shah, account menu', exact: true }),
  ).toBeVisible();
  await expect.poll(() => storedAttempts(other)).toEqual([]);

  await other.goto(balancesURL(ledger));
  await expect(recordSettlement(other)).toBeVisible();
  await expect(checkPayment(other)).toHaveCount(0);
  await expect(other.getByText(/may already be recorded/)).toHaveCount(0);
});
