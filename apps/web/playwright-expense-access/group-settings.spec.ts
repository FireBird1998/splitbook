import type { APIRequestContext, Page, Request, Route } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, joinGroup } from './fixtures';

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

async function enter(page: Page, actor: APIRequestContext, path: string) {
  await page.context().addCookies((await actor.storageState()).cookies);
  await page.goto(appURL(path));
}

const memberPath = (group: string, persona: keyof typeof DEMO_PERSONA_IDS) =>
  `/api/groups/${group}/members/${DEMO_PERSONA_IDS[persona]}`;

test('member rule violations answer with their reason instead of a server error', async ({
  ledger,
}) => {
  const demoted = await ledger.alex.patch(memberPath(ledger.groupA, 'alex'), {
    data: { role: 'member' },
  });
  expect(demoted.status(), await demoted.text()).toBe(409);
  expect((await demoted.json()).error).toBe(
    'Cannot demote the last admin. Promote another member first.',
  );

  const removed = await ledger.alex.delete(memberPath(ledger.groupA, 'alex'));
  expect(removed.status(), await removed.text()).toBe(400);
  expect((await removed.json()).error).toBe('You cannot remove yourself. Use leave group instead.');

  const group = await dataOf(await ledger.alex.get(`/api/groups/${ledger.groupA}`));
  expect(group.members).toEqual([
    expect.objectContaining({
      role: 'admin',
      user: expect.objectContaining({ name: 'Alex Rivera' }),
    }),
  ]);
});

/** Keep every alert text the page shows, including ones a refresh removes again. */
async function recordAlerts(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __alerts: seen });
    new MutationObserver(() => {
      for (const alert of document.querySelectorAll('[role="alert"]')) {
        const text = alert.textContent?.trim();
        if (text && !seen.includes(text)) seen.push(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __alerts: string[] }).__alerts);
}

async function memberRoles(actor: APIRequestContext, group: string) {
  const { members } = await dataOf(await actor.get(`/api/groups/${group}`));
  return Object.fromEntries(
    members.map((member: { user: { _id: string }; role: string }) => [
      member.user._id,
      member.role,
    ]),
  );
}

test('a member action from a stale admin page is refused, not announced as done', async ({
  page,
  ledger,
}) => {
  await joinGroup(ledger.alex, ledger.sam, ledger.groupA);
  await dataOf(
    await ledger.alex.patch(memberPath(ledger.groupA, 'sam'), { data: { role: 'admin' } }),
  );
  const alerts = await recordAlerts(page);
  await enter(page, ledger.alex, `/groups/${ledger.groupA}/settings`);
  await page.getByRole('button', { name: /^Actions for member Sam/ }).click();
  const demote = page.getByRole('menuitem', { name: 'Demote to Member' });
  await expect(demote).toBeVisible();

  // Sam removes Alex's admin role while Alex's page still offers the action.
  await dataOf(
    await ledger.sam.patch(memberPath(ledger.groupA, 'alex'), { data: { role: 'member' } }),
  );
  await demote.click();

  // The refusal refreshes the page, which now reflects Alex's actual access.
  await expect(page.getByText('Only admins can change this Group’s settings.')).toBeVisible();
  expect(await alerts()).not.toContain('Demoted to member');
  expect(await memberRoles(ledger.sam, ledger.groupA)).toEqual({
    [DEMO_PERSONA_IDS.alex]: 'member',
    [DEMO_PERSONA_IDS.sam]: 'admin',
  });
});

test('a refused member action shows the server’s reason', async ({ page, ledger }) => {
  await joinGroup(ledger.alex, ledger.sam, ledger.groupA);
  await enter(page, ledger.alex, `/groups/${ledger.groupA}/settings`);
  const reason = 'Member changes are paused for this Group.';
  await page.route(`**${memberPath(ledger.groupA, 'sam')}`, (route) =>
    route.fulfill({ status: 409, json: { error: reason, status: 409 } }),
  );
  await page.getByRole('button', { name: /^Actions for member Sam/ }).click();
  await page.getByRole('menuitem', { name: 'Promote to Admin' }).click();

  await expect(page.getByRole('alert').filter({ hasText: reason })).toBeVisible();
  await expect(page.getByText('Promoted to admin')).toHaveCount(0);
  expect(await memberRoles(ledger.alex, ledger.groupA)).toEqual({
    [DEMO_PERSONA_IDS.alex]: 'admin',
    [DEMO_PERSONA_IDS.sam]: 'member',
  });
});

test('a locked Group currency explains why the change was not saved', async ({ page, ledger }) => {
  await enter(page, ledger.alex, `/groups/${ledger.groupA}/settings`);
  await page.getByRole('combobox', { name: 'Default Currency' }).click();
  await page.getByRole('option', { name: / USD —/ }).click();
  await page.getByRole('button', { name: 'Save Currency' }).click();

  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Currency cannot change after this Group has financial records.' }),
  ).toBeVisible();
  await expect(page.getByText('Currency settings updated')).toHaveCount(0);
  expect(await dataOf(await ledger.alex.get(`/api/groups/${ledger.groupA}`))).toMatchObject({
    defaultCurrency: 'INR',
  });
});

test.describe('new entry dates follow the viewer’s calendar day', () => {
  test.use({ timezoneId: 'Asia/Kolkata' });

  // 01:30 on 29 September in Kolkata is still 28 September in UTC.
  const lateNight = new Date('2026-09-28T20:00:00.000Z');

  test('a new Expense defaults to the local day', async ({ page, ledger }) => {
    await page.clock.setSystemTime(lateNight);
    await enter(page, ledger.alex, `/groups/${ledger.groupA}?action=add-expense`);
    const dialog = page.getByRole('dialog', { name: 'Add expense' });
    await expect(dialog.getByLabel('Date')).toHaveValue('2026-09-29');
  });

  test('a new recurring Expense starts on the local day', async ({ page, ledger }) => {
    await page.clock.setSystemTime(lateNight);
    await enter(page, ledger.alex, `/groups/${ledger.groupA}/settings`);
    await page
      .locator('.MuiPaper-root')
      .filter({ hasText: 'Expenses that log themselves every month' })
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Add recurring expense' });
    await expect(dialog.getByLabel('Starts on')).toHaveValue('2026-09-29');
  });
});

const leavePath = (group: string) => `/api/groups/${group}/leave`;

test('leaving waits until the member is settled up and another admin remains', async ({
  ledger,
}) => {
  await joinGroup(ledger.alex, ledger.sam, ledger.groupA);
  await dataOf(
    await ledger.alex.post(`/api/groups/${ledger.groupA}/expenses`, {
      data: {
        description: 'Groceries',
        amount: 300,
        currency: 'INR',
        category: 'food',
        tag: 'Groceries',
        date: new Date().toISOString(),
        paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 300 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.alex }, { user: DEMO_PERSONA_IDS.sam }],
      },
    }),
    201,
  );

  const owing = await ledger.sam.post(leavePath(ledger.groupA));
  expect(owing.status(), await owing.text()).toBe(409);
  const owingBody = await owing.json();
  expect(owingBody).toMatchObject({
    code: 'OPEN_BALANCE',
    balances: [{ currency: 'INR', amount: -150 }],
  });
  expect(owingBody.error).toMatch(
    /^Settle up before you leave: you owe .*150\.00 in this Group\.$/,
  );

  const lastAdmin = await ledger.alex.post(leavePath(ledger.groupA));
  expect(lastAdmin.status(), await lastAdmin.text()).toBe(409);
  expect(await lastAdmin.json()).toMatchObject({
    code: 'LAST_ADMIN',
    error: 'Make someone else an admin before you leave.',
  });

  await dataOf(
    await ledger.sam.post(`/api/groups/${ledger.groupA}/settlements`, {
      data: { paidTo: DEMO_PERSONA_IDS.alex, amount: 150, currency: 'INR' },
    }),
    201,
  );
  expect(await dataOf(await ledger.sam.post(leavePath(ledger.groupA)))).toEqual({
    message: 'Left group',
    archived: false,
  });
  expect(await memberRoles(ledger.alex, ledger.groupA)).toEqual({
    [DEMO_PERSONA_IDS.alex]: 'admin',
  });
  expect((await ledger.sam.get(`/api/groups/${ledger.groupA}`)).status()).toBe(403);
});

test('a sole member confirms cleanup, with safe refusal when deletion is unavailable', async ({
  page,
  ledger,
}) => {
  const name = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!name || !/^splitbook-test-access-[a-f0-9-]+$/.test(name))
    throw new Error('Unique isolated test database required');
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${name}?directConnection=true`, {
    serverSelectionTimeoutMS: 5_000,
  });
  const path = leavePath(ledger.groupA);
  let leaveRequests = 0;
  let forwardedLeaves = 0;
  const observed: { reply?: { status: number; body: unknown; requestBody: unknown } } = {};
  const observeLeave = (request: Request) => {
    if (request.method() === 'POST' && request.url() === appURL(path)) leaveRequests += 1;
  };
  const captureActualLeave = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    forwardedLeaves += 1;
    const response = await route.fetch();
    const body = await response.body();
    // Read the real backend reply before forwarding it: successful leave hard-navigates.
    observed.reply = {
      status: response.status(),
      body: JSON.parse(body.toString('utf8')),
      requestBody: route.request().postDataJSON(),
    };
    await route.fulfill({ response, body });
  };
  try {
    await client.connect();
    const db = client.db(name);
    const hello = await db.admin().command({ hello: 1 });
    const transactionCapable = !!hello.setName || hello.msg === 'isdbgrid';
    const groupId = new ObjectId(ledger.groupA);
    const groupIds = [groupId, new ObjectId(ledger.groupB)];
    const children = ['expenses', 'settlements', 'activities', 'recurringexpenses', 'invitations'];
    const snapshot = async () => ({
      groups: await db
        .collection('groups')
        .find({ _id: { $in: groupIds } })
        .sort({ _id: 1 })
        .toArray(),
      histories: await Promise.all(
        children.map(async (collection) => ({
          collection,
          records: await db
            .collection(collection)
            .find({ group: { $in: groupIds } })
            .sort({ _id: 1 })
            .toArray(),
        })),
      ),
      accountIds: await db
        .collection('users')
        .find({
          _id: { $in: Object.values(DEMO_PERSONA_IDS).map((id) => new ObjectId(id)) },
        })
        .project({ _id: 1 })
        .sort({ _id: 1 })
        .toArray(),
    });
    await enter(page, ledger.alex, `/groups/${ledger.groupA}/settings`);
    await expect(page.getByRole('button', { name: 'Leave Group', exact: true })).toBeVisible();
    const before = await snapshot();
    expect(before.accountIds).toHaveLength(3);
    expect(before.groups.find((group) => String(group._id) === ledger.groupA)).toMatchObject({
      members: [{ user: new ObjectId(DEMO_PERSONA_IDS.alex), role: 'admin' }],
    });
    expect(before.histories.find((history) => history.collection === 'expenses')?.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: new ObjectId(ledger.expenseA) })]),
    );
    expect(
      before.histories
        .find((history) => history.collection === 'activities')
        ?.records.some((record) => String(record.group) === ledger.groupA),
    ).toBe(true);

    // Older clients and an explicit refusal must both retain membership and every history record.
    for (const data of [undefined, { deleteIfLastMember: false }]) {
      const refused = await ledger.alex.post(path, data === undefined ? {} : { data });
      expect(refused.status(), await refused.text()).toBe(409);
      expect(await refused.json()).toMatchObject({ code: 'GROUP_DELETION_CONFIRMATION_REQUIRED' });
      expect(await snapshot()).toEqual(before);
      expect(await db.collection('groupdeletions').countDocuments({ _id: groupId })).toBe(0);
    }

    page.on('request', observeLeave);
    const dialog = page.getByRole('dialog', { name: /^Leave/ });
    await page.getByRole('button', { name: 'Leave Group', exact: true }).click();
    await expect(
      dialog.getByText(/Leaving will permanently delete this Group and its history/),
    ).toBeVisible();
    await expect(dialog.getByText(/You cannot rejoin this Group/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await snapshot()).toEqual(before);
    expect(leaveRequests).toBe(0);

    await page.route(appURL(path), captureActualLeave);
    await page.getByRole('button', { name: 'Leave Group', exact: true }).click();
    const confirmation = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url() === appURL(path),
    );
    await dialog.getByRole('button', { name: 'Leave and delete Group', exact: true }).click();
    await confirmation;
    const confirmed = observed.reply;
    if (!confirmed) throw new Error('The real leave response was not captured');
    expect(confirmed.requestBody).toEqual({ deleteIfLastMember: true });
    expect(leaveRequests).toBe(1);
    expect(forwardedLeaves).toBe(1);

    if (!transactionCapable) {
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(409);
      expect(confirmed.body).toMatchObject({ code: 'GROUP_DELETION_UNAVAILABLE' });
      await expect(
        dialog.getByRole('alert').filter({
          hasText: 'You are still a member; no history was deleted.',
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/groups/${ledger.groupA}/settings$`));
      expect(await snapshot()).toEqual(before);
      expect(await db.collection('groupdeletions').countDocuments({ _id: groupId })).toBe(0);
    } else {
      const deleted = {
        message: 'Left group',
        archived: true,
        deleted: true,
        deletionPending: false,
      };
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body).toEqual({ data: deleted, status: 200 });
      await expect(page).toHaveURL(/\/dashboard$/);
      expect((await ledger.alex.get(`/api/groups/${ledger.groupA}`)).status()).toBe(404);
      const groups = await dataOf(await ledger.alex.get('/api/groups'));
      expect(groups.map((group: { _id: string }) => group._id)).not.toContain(ledger.groupA);
      expect(await db.collection('groups').countDocuments({ _id: groupId })).toBe(0);
      for (const collection of children)
        expect(await db.collection(collection).countDocuments({ group: groupId }), collection).toBe(
          0,
        );
      const after = await snapshot();
      expect(after).toEqual({
        groups: before.groups.filter((group) => String(group._id) !== ledger.groupA),
        histories: before.histories.map((history) => ({
          ...history,
          records: history.records.filter((record) => String(record.group) !== ledger.groupA),
        })),
        accountIds: before.accountIds,
      });
      expect((await db.collection('groupdeletions').findOne({ _id: groupId }))?.state).toBe(
        'complete',
      );
      expect(
        await dataOf(await ledger.alex.post(path, { data: { deleteIfLastMember: true } })),
      ).toEqual(deleted);
      expect(await snapshot()).toEqual(after);
    }
    // Both topologies retain the user's account and the unrelated Group and its Expense.
    expect((await (await ledger.alex.get('/api/auth/get-session')).json()).user.id).toBe(
      DEMO_PERSONA_IDS.alex,
    );
    expect((await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}`)))._id).toBe(
      ledger.groupB,
    );
    expect(
      (
        await dataOf(
          await ledger.priya.get(`/api/groups/${ledger.groupB}/expenses/${ledger.expenseB}`),
        )
      )._id,
    ).toBe(ledger.expenseB);
    expect(leaveRequests).toBe(1);
    expect(forwardedLeaves).toBe(1);
  } finally {
    page.off('request', observeLeave);
    if (!page.isClosed()) await page.unroute(appURL(path), captureActualLeave);
    await client.close();
  }
});

test('a member leaves from Group settings and lands on Home', async ({ page, ledger }) => {
  await enter(page, ledger.sam, `/groups/${ledger.groupB}/settings`);
  await expect(page.getByText('Only admins can change this Group’s settings.')).toBeVisible();

  await page.getByRole('button', { name: 'Leave Group' }).click();
  const dialog = page.getByRole('dialog', { name: /^Leave/ });
  await dialog.getByRole('button', { name: 'Leave Group' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await memberRoles(ledger.priya, ledger.groupB)).toEqual({
    [DEMO_PERSONA_IDS.priya]: 'admin',
  });
});

test('a refused leave explains why and keeps the member in the Group', async ({ page, ledger }) => {
  await joinGroup(ledger.alex, ledger.sam, ledger.groupA);
  await enter(page, ledger.alex, `/groups/${ledger.groupA}/settings`);

  await page.getByRole('button', { name: 'Leave Group' }).click();
  const dialog = page.getByRole('dialog', { name: /^Leave/ });
  await dialog.getByRole('button', { name: 'Leave Group' }).click();

  await expect(
    dialog.getByRole('alert').filter({ hasText: 'Make someone else an admin before you leave.' }),
  ).toBeVisible();
  expect(await memberRoles(ledger.alex, ledger.groupA)).toEqual({
    [DEMO_PERSONA_IDS.alex]: 'admin',
    [DEMO_PERSONA_IDS.sam]: 'member',
  });
});
