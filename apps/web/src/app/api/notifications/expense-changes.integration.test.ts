/**
 * Expense updated / deleted alerts and recurring Expense-added alerts (#841), through the normal
 * authenticated routes against a real MongoDB replica set. Only the Google transport
 * (`sendFcm`) is substituted. Each journey starts from an ordinary member request (or the
 * recurring generator a read runs) and checks the immutable audience the financial commit
 * captured, the provider request each opted-in phone receives, and that the financial result is
 * the same as without notifications.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';
import { groupService } from '@/lib/services/group.service';
import { DEMO_PERSONA_IDS as users } from '@/lib/demo-personas';
import Activity from '@/lib/models/Activity';
import { toPeriod } from '@splitbook/shared/recurring-due-periods';
vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);
const provider = vi.hoisted(() => ({
  send: vi.fn(
    async (
      _message: unknown,
      _signal: AbortSignal,
      authorize: () => Promise<boolean>,
    ): Promise<string> => ((await authorize()) ? 'accepted' : 'ineligible'),
  ),
}));
vi.mock('@/lib/notifications/provider', () => ({ sendFcm: provider.send }));
const db = integrationTestDb('expense-change-notifications');
let expenses: typeof import('@/app/api/groups/[id]/expenses/route');
let item: typeof import('@/app/api/groups/[id]/expenses/[expenseId]/route');
let device: typeof import('@/app/api/notifications/device/route');
let dispatch: typeof import('@/app/api/notifications/dispatch/route');
let activity: typeof import('@/app/api/groups/[id]/activity/route');
let recurring: typeof import('@/app/api/groups/[id]/recurring/route');
let cookies: Record<'alex' | 'sam' | 'priya', string>;
let group: string;
const secret = 'isolated-notification-dispatch-secret-841';
const installationKey = 'private-test-installation-proof-841';
const phones = {
  alex: '00000000-0000-4000-8000-000000000841',
  sam: '00000000-0000-4000-8000-000000000842',
  priya: '00000000-0000-4000-8000-000000000843',
} as const;
/** Membership ends directly, whatever the member's balance: removal itself is not under test. */
const removeFromGroup = (user: string) =>
  mongoose.connection
    .db!.collection('groups')
    .updateOne({ _id: new mongoose.Types.ObjectId(group) }, {
      $pull: { members: { user: new mongoose.Types.ObjectId(user) } },
    } as never);
const financial = () => mongoose.connection.db!.collection('expenses');
const activities = () => mongoose.connection.db!.collection('activities');

beforeAll(async () => {
  await connectSignedIn(db);
  expenses = await import('@/app/api/groups/[id]/expenses/route');
  item = await import('@/app/api/groups/[id]/expenses/[expenseId]/route');
  device = await import('@/app/api/notifications/device/route');
  dispatch = await import('@/app/api/notifications/dispatch/route');
  activity = await import('@/app/api/groups/[id]/activity/route');
  recurring = await import('@/app/api/groups/[id]/recurring/route');
});
afterAll(() => disconnectSignedIn(db));

async function optIn(who: keyof typeof phones) {
  const registered = await callRoute(device.POST, {
    method: 'POST',
    path: '/api/notifications/device',
    cookie: cookies[who],
    body: {
      installationId: phones[who],
      installationKey,
      revision: 0,
      enabled: true,
      token: 'fictional-private-fcm-token-' + who,
    },
  });
  expect(registered.status).toBe(200);
}

beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  cookies = { alex: await signIn('alex'), sam: await signIn('sam'), priya: await signIn('priya') };
  group = String(
    (
      await groupService.create(
        {
          name: 'Fictional changes',
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies: [],
        },
        users.alex,
      )
    )._id,
  );
  await groupService.addMember(group, users.sam);
  await groupService.addMember(group, users.priya);
  provider.send.mockReset();
  provider.send.mockImplementation(async (_message, _signal, authorize) =>
    (await authorize()) ? 'accepted' : 'ineligible',
  );
  vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'true');
  vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
  vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
  vi.stubEnv('MOBILE_APP_ENV', 'development');
  vi.stubEnv('NOTIFICATION_DISPATCH_SECRET', secret);
  await optIn('alex');
  await optIn('sam');
  await optIn('priya');
});

/** Alex records ₹100 paid by Alex, split with Sam only. Answers the new Expense's id. */
async function createExpense(): Promise<string> {
  const saved = await callRoute(expenses.POST, {
    method: 'POST',
    path: '/api/groups/' + group + '/expenses',
    params: { id: group },
    cookie: cookies.alex,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      description: 'Fictional private dinner',
      amount: 100,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: '2026-11-06',
      paidBy: [{ user: users.alex, amount: 100 }],
      splitMethod: 'equal',
      splitBetween: [{ user: users.sam }],
    },
  });
  expect(saved.status).toBe(201);
  return String(saved.body.data._id);
}
const patch = (
  expenseId: string,
  body: object,
  revision: number,
  who: keyof typeof phones = 'alex',
) =>
  callRoute(item.PATCH, {
    method: 'PATCH',
    path: '/api/groups/' + group + '/expenses/' + expenseId,
    params: { id: group, expenseId },
    cookie: cookies[who],
    headers: { 'X-Splitbook-Revision': String(revision) },
    body,
  });
const remove = (expenseId: string, revision: number, who: keyof typeof phones = 'alex') =>
  callRoute(item.DELETE, {
    method: 'DELETE',
    path: '/api/groups/' + group + '/expenses/' + expenseId,
    params: { id: group, expenseId },
    cookie: cookies[who],
    headers: { 'X-Splitbook-Revision': String(revision) },
  });
/** Split the ₹100 with Priya alone: Sam leaves the Expense, Priya joins it. */
const toPriya = {
  paidBy: [{ user: users.alex, amount: 100 }],
  splitBetween: [{ user: users.priya }],
};
const run = () =>
  callRoute(dispatch.POST, {
    method: 'POST',
    path: '/api/notifications/dispatch',
    cookie: '',
    headers: { authorization: 'Bearer ' + secret },
  });
type Sent = { kind: string; accountId: string; eventId: string; recordId: string };
/** Every provider request so far, as the envelope each carried; optionally only one kind. */
function sent(kind?: string): Sent[] {
  return provider.send.mock.calls
    .map((call) => JSON.parse((call[0] as { data: { body: string } }).data.body) as Sent)
    .filter((envelope) => !kind || envelope.kind === kind);
}
const recipients = (kind: string) =>
  sent(kind)
    .map((envelope) => envelope.accountId)
    .sort();
const contextOf = async (type: string) =>
  (await activities().find({ type }).sort({ _id: 1 }).toArray()).map(
    (event) => event.notificationContext,
  );

describe('Expense updated, deleted and recurring alerts (#841)', () => {
  it('an edit alerts the before-and-after participants, including one removed from the Expense, never the editor', async () => {
    const expenseId = await createExpense();
    const edited = await patch(expenseId, toPriya, 0);
    expect(edited.status).toBe(200);
    expect(recipients('expense_updated')).toEqual([users.sam, users.priya].sort());
    const [context] = await contextOf('expense_updated');
    expect(context).toMatchObject({
      version: 2,
      kind: 'expense_updated',
      groupId: group,
      recordId: expenseId,
      recipientIds: [users.priya, users.sam].sort(),
    });
    const update = sent('expense_updated')[0];
    expect(update.recordId).toBe(expenseId);
    const message = provider.send.mock.calls.at(-1)![0] as { data: Record<string, string> };
    // Data-only, as Expense-added alerts are (#968): the envelope alone, no ledger details.
    expect(Object.keys(message.data)).toEqual(['body']);
    expect(JSON.stringify(message.data)).not.toMatch(/Fictional|dinner|amount|token|Priya|Sam/);
    // A retry after a lost reply carries the old revision: refused, no second event or send.
    expect((await patch(expenseId, toPriya, 0)).status).toBe(409);
    await run();
    await run();
    expect(sent('expense_updated')).toHaveLength(2);
    expect(await activities().countDocuments({ type: 'expense_updated' })).toBe(1);
    expect((await financial().findOne({}))!.pendingActivity).toEqual([]);
    // Public reads still carry no private context.
    const feed = await callRoute(activity.GET, {
      method: 'GET',
      path: '/api/groups/' + group + '/activity',
      params: { id: group },
      cookie: cookies.sam,
    });
    expect(JSON.stringify(feed.body)).not.toMatch(/notificationContext|recipientIds/);
    expect(JSON.stringify(edited.body)).not.toMatch(
      /notificationContext|recipientIds|pendingActivity/,
    );
    expect(await Activity.findOne({ type: 'expense_updated' }).lean()).not.toHaveProperty(
      'notificationContext',
    );
  });

  it('a later edit cannot change an earlier audience; removal suppresses and a new member is not historical', async () => {
    await removeFromGroup(users.priya);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    const expenseId = await createExpense();
    // First edit: only Sam is involved and Priya isn't a member.
    expect((await patch(expenseId, { description: 'Fictional renamed dinner' }, 0)).status).toBe(
      200,
    );
    await groupService.addMember(group, users.priya);
    // Second edit: Priya joins the Expense, Sam leaves it.
    expect((await patch(expenseId, toPriya, 1)).status).toBe(200);
    const [first, second] = await contextOf('expense_updated');
    expect(first.recipientIds).toEqual([users.sam]);
    expect(second.recipientIds).toEqual([users.priya, users.sam].sort());
    await removeFromGroup(users.sam);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await run();
    await run();
    const updates = sent('expense_updated');
    expect(updates).toEqual([
      expect.objectContaining({ accountId: users.priya, eventId: String(second.eventId) }),
    ]);
  });

  it('deletion alerts the recorded participants with the deleted kind and makes no other financial write', async () => {
    const expenseId = await createExpense();
    const before = await financial().findOne({});
    const deleted = await remove(expenseId, 0);
    expect(deleted.status).toBe(200);
    expect(recipients('expense_deleted')).toEqual([users.sam]);
    const after = await financial().findOne({});
    expect(await financial().countDocuments()).toBe(1);
    expect(after).toMatchObject({ isDeleted: true, amount: before!.amount, pendingActivity: [] });
    // Deleting it again is the same deletion: no second event or send.
    expect((await remove(expenseId, 1)).status).toBe(200);
    await run();
    expect(sent('expense_deleted')).toHaveLength(1);
    expect(await activities().countDocuments({ type: 'expense_deleted' })).toBe(1);
  });

  it('restoration is the existing updated event, not a new financial operation', async () => {
    const expenseId = await createExpense();
    expect((await remove(expenseId, 0)).status).toBe(200);
    const restored = await patch(expenseId, { isDeleted: false }, 1);
    expect(restored.status).toBe(200);
    expect(recipients('expense_updated')).toEqual([users.sam]);
    const event = await activities().findOne({ type: 'expense_updated' });
    expect(event!.metadata.action).toBe('restored');
    expect(await financial().countDocuments()).toBe(1);
    expect((await financial().findOne({}))!.isDeleted).toBe(false);
  });

  it('the member who edits or deletes is excluded, whoever created the Expense', async () => {
    const expenseId = await createExpense();
    provider.send.mockClear();
    expect((await patch(expenseId, { description: 'Fictional by Sam' }, 0, 'sam')).status).toBe(
      200,
    );
    expect(recipients('expense_updated')).toEqual([users.alex]);
    expect((await remove(expenseId, 1, 'sam')).status).toBe(200);
    expect(recipients('expense_deleted')).toEqual([users.alex]);
  });

  it('an edit whose Activity publication was lost is recovered and alerts once', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    const expenseId = await createExpense();
    const upsert = vi
      .spyOn(Activity, 'updateOne')
      .mockRejectedValueOnce(new Error('Simulated Activity publication outage'));
    const edited = await patch(expenseId, toPriya, 0);
    upsert.mockRestore();
    expect(edited.status).toBe(200);
    const pending = (await financial().findOne({}))!.pendingActivity;
    expect(pending).toHaveLength(1);
    expect(pending[0].notificationContext.recipientIds).toEqual([users.priya, users.sam].sort());
    expect(await activities().countDocuments({ type: 'expense_updated' })).toBe(0);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    // A Group read recovers the intent; the dispatcher then sends it once.
    expect(
      (
        await callRoute(activity.GET, {
          method: 'GET',
          path: '/api/groups/' + group + '/activity',
          params: { id: group },
          cookie: cookies.alex,
        })
      ).status,
    ).toBe(200);
    expect((await financial().findOne({}))!.pendingActivity).toEqual([]);
    await run();
    await run();
    expect(recipients('expense_updated')).toEqual([users.priya, users.sam].sort());
  });

  it('a refused or failed edit and deletion record no event and send nothing', async () => {
    const expenseId = await createExpense();
    provider.send.mockClear();
    expect((await patch(expenseId, toPriya, 7)).status).toBe(409);
    expect((await remove(expenseId, 7)).status).toBe(409);
    const outsider = new mongoose.Types.ObjectId().toHexString();
    expect(
      (
        await patch(
          expenseId,
          { paidBy: [{ user: outsider, amount: 100 }], splitBetween: [{ user: outsider }] },
          0,
        )
      ).status,
    ).toBe(422);
    await run();
    expect(provider.send).not.toHaveBeenCalled();
    expect(
      await activities().countDocuments({ type: { $in: ['expense_updated', 'expense_deleted'] } }),
    ).toBe(0);
    expect((await financial().findOne({}))!.isDeleted).toBe(false);
  });

  it('preparing, editing and discarding a Draft and reading suggested payments send nothing', async () => {
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
    await createExpense();
    provider.send.mockClear();
    const drafts = await import('@/app/api/groups/[id]/drafts/route');
    const draft = await import('@/app/api/groups/[id]/drafts/[draftId]/route');
    const balances = await import('@/app/api/groups/[id]/balances/route');
    const prepared = await callRoute(drafts.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/drafts',
      params: { id: group },
      cookie: cookies.alex,
      headers: { 'Idempotency-Key': randomUUID() },
      body: { drafts: [{ description: 'Fictional taxi', amount: 450 }] },
    });
    expect(prepared.status).toBe(201);
    const draftId = prepared.body.data[0].id as string;
    const edited = await callRoute(draft.PUT, {
      method: 'PUT',
      path: '/api/groups/' + group + '/drafts/' + draftId,
      params: { id: group, draftId },
      cookie: cookies.alex,
      headers: { 'X-Splitbook-Revision': '0' },
      body: { values: { description: 'Fictional cab', amount: 500 } },
    });
    expect(edited.status).toBe(200);
    const discarded = await callRoute(draft.DELETE, {
      method: 'DELETE',
      path: '/api/groups/' + group + '/drafts/' + draftId,
      params: { id: group, draftId },
      cookie: cookies.alex,
      headers: { 'X-Splitbook-Revision': '1' },
    });
    expect(discarded.status).toBe(200);
    const suggested = await callRoute(balances.GET, {
      method: 'GET',
      path: '/api/groups/' + group + '/balances',
      params: { id: group },
      cookie: cookies.sam,
    });
    expect(suggested.status).toBe(200);
    await run();
    expect(provider.send).not.toHaveBeenCalled();
    expect(await financial().countDocuments()).toBe(1);
  });

  it('a generated recurring Expense alerts the involved members, never the template creator', async () => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    const household = String(
      (
        await groupService.create(
          {
            name: 'Fictional flat',
            category: 'home',
            defaultCurrency: 'INR',
            alternateCurrencies: [],
          },
          users.alex,
        )
      )._id,
    );
    await groupService.addMember(household, users.sam);
    const created = await callRoute(recurring.POST, {
      method: 'POST',
      path: '/api/groups/' + household + '/recurring',
      params: { id: household },
      cookie: cookies.alex,
      body: {
        description: 'Fictional rent',
        amount: 300,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: users.alex, amount: 300 }],
        splitMethod: 'equal',
        splitBetween: [{ user: users.alex }, { user: users.sam }],
        dayOfMonth: 1,
        startsOn: `${toPeriod(new Date())}-01`,
      },
    });
    expect(created.status).toBe(201);
    const generated = await financial().findOne({ group: new mongoose.Types.ObjectId(household) });
    expect(generated).toMatchObject({ pendingActivity: [] });
    expect(sent('expense_added')).toEqual([
      expect.objectContaining({ accountId: users.sam, recordId: String(generated!._id) }),
    ]);
    // Later reads generate nothing new and send nothing more.
    await callRoute(activity.GET, {
      method: 'GET',
      path: '/api/groups/' + household + '/activity',
      params: { id: household },
      cookie: cookies.alex,
    });
    await run();
    expect(sent('expense_added')).toHaveLength(1);
  });
});

describe('with the Expense changes switch off (#841 rollout)', () => {
  beforeEach(() => {
    vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', undefined);
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
  });
  it('edits, deletion, restoration and recurring generation send nothing; Expense-added alerts stay exactly as they are', async () => {
    const expenseId = await createExpense();
    expect(recipients('expense_added')).toEqual([users.sam]);
    expect((await patch(expenseId, toPriya, 0)).status).toBe(200);
    expect((await remove(expenseId, 1)).status).toBe(200);
    expect((await patch(expenseId, { isDeleted: false }, 2)).status).toBe(200);
    const household = String(
      (
        await groupService.create(
          {
            name: 'Fictional flat',
            category: 'home',
            defaultCurrency: 'INR',
            alternateCurrencies: [],
          },
          users.alex,
        )
      )._id,
    );
    await groupService.addMember(household, users.sam);
    expect(
      (
        await callRoute(recurring.POST, {
          method: 'POST',
          path: '/api/groups/' + household + '/recurring',
          params: { id: household },
          cookie: cookies.alex,
          body: {
            description: 'Fictional rent',
            amount: 300,
            currency: 'INR',
            category: 'housing',
            tag: 'Rent',
            paidBy: [{ user: users.alex, amount: 300 }],
            splitMethod: 'equal',
            splitBetween: [{ user: users.alex }, { user: users.sam }],
            dayOfMonth: 1,
            startsOn: `${toPeriod(new Date())}-01`,
          },
        })
      ).status,
    ).toBe(201);
    await run();
    expect(sent()).toEqual([
      expect.objectContaining({ kind: 'expense_added', accountId: users.sam }),
    ]);
    // Nothing captured, as before #841: turning the switch on later sends no backlog.
    expect(
      await activities().countDocuments({
        type: { $in: ['expense_updated', 'expense_deleted'] },
        notificationContext: { $exists: true },
      }),
    ).toBe(0);
    expect(
      await activities().countDocuments({
        'metadata.recurring': true,
        notificationContext: { $exists: true },
      }),
    ).toBe(0);
    vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
    await run();
    expect(sent()).toHaveLength(1);
  });
  it('turning the switch off stops sends of already captured changes', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    const expenseId = await createExpense();
    expect((await patch(expenseId, toPriya, 0)).status).toBe(200);
    vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', undefined);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await run();
    expect(sent().map((envelope) => envelope.kind)).toEqual(['expense_added']);
  });
});
