/**
 * Payment alerts (#842): single, batch and Cross-currency Settlement recording, through the
 * normal authenticated routes against a real MongoDB replica set. Only the Google transport
 * (`sendFcm`) is substituted. Each journey starts from an ordinary member request and checks the
 * immutable audience the financial commit captured, the provider request each opted-in phone
 * receives, and that the recorded money is the same as without notifications.
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
  requireReplicaSet,
  signIn,
} from '@/lib/test-utils/signed-in-route';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { DEMO_PERSONA_IDS as users } from '@/lib/demo-personas';
import Activity from '@/lib/models/Activity';
import Settlement from '@/lib/models/Settlement';
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
const db = integrationTestDb('payment-notifications');
let single: typeof import('@/app/api/groups/[id]/settlements/route');
let batch: typeof import('@/app/api/groups/[id]/settlements/batch/route');
let expenses: typeof import('@/app/api/groups/[id]/expenses/route');
let balances: typeof import('@/app/api/groups/[id]/balances/route');
let device: typeof import('@/app/api/notifications/device/route');
let dispatch: typeof import('@/app/api/notifications/dispatch/route');
let activity: typeof import('@/app/api/groups/[id]/activity/route');
let homeActivity: typeof import('@/app/api/user/activity/route');
type Who = 'alex' | 'sam' | 'priya';
let cookies: Record<Who, string>;
let group: string;
const secret = 'isolated-notification-dispatch-secret-842';
const installationKey = 'private-test-installation-proof-842';
const phones = {
  alex: '00000000-0000-4000-8000-000000000a42',
  sam: '00000000-0000-4000-8000-000000000b42',
  priya: '00000000-0000-4000-8000-000000000c42',
} as const;
const revisions: Record<Who, number> = { alex: 0, sam: 0, priya: 0 };
/** Membership ends directly, whatever the member's balance: removal itself is not under test. */
const removeFromGroup = (user: string) =>
  mongoose.connection
    .db!.collection('groups')
    .updateOne({ _id: new mongoose.Types.ObjectId(group) }, {
      $pull: { members: { user: new mongoose.Types.ObjectId(user) } },
    } as never);
const settlements = () => mongoose.connection.db!.collection('settlements');
const activities = () => mongoose.connection.db!.collection('activities');
const deliveries = () => mongoose.connection.db!.collection('notificationDeliveries');

beforeAll(async () => {
  await connectSignedIn(db);
  await requireReplicaSet();
  single = await import('@/app/api/groups/[id]/settlements/route');
  batch = await import('@/app/api/groups/[id]/settlements/batch/route');
  expenses = await import('@/app/api/groups/[id]/expenses/route');
  balances = await import('@/app/api/groups/[id]/balances/route');
  device = await import('@/app/api/notifications/device/route');
  dispatch = await import('@/app/api/notifications/dispatch/route');
  activity = await import('@/app/api/groups/[id]/activity/route');
  homeActivity = await import('@/app/api/user/activity/route');
});
afterAll(() => disconnectSignedIn(db));

/** This phone's Settings change, as the app sends it; the first call is the opt-in. */
async function controls(who: Who, choice: { expenseUpdates?: boolean; payments?: boolean } = {}) {
  const saved = await callRoute(device.POST, {
    method: 'POST',
    path: '/api/notifications/device',
    cookie: cookies[who],
    body: {
      installationId: phones[who],
      installationKey,
      revision: revisions[who],
      enabled: true,
      ...choice,
      ...(revisions[who] ? {} : { token: 'fictional-private-fcm-token-' + who }),
    },
  });
  expect(saved.status).toBe(200);
  revisions[who] = saved.body.data.revision;
  return saved.body.data;
}

beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  cookies = { alex: await signIn('alex'), sam: await signIn('sam'), priya: await signIn('priya') };
  group = String(
    (
      await groupService.create(
        {
          name: 'Fictional payments',
          category: 'trip',
          defaultCurrency: 'INR',
          alternateCurrencies: ['EUR', 'JPY'],
        },
        users.alex,
      )
    )._id,
  );
  await groupService.addMember(group, users.sam);
  await groupService.addMember(group, users.priya);
  // Alex paid ₹300 and €30 for all three: Sam and Priya each owe Alex ₹100 and €10.
  for (const [currency, amount] of [
    ['INR', 300],
    ['EUR', 30],
  ] as const)
    await expenseService.create(
      group,
      {
        description: 'Fictional private dinner',
        amount,
        currency,
        category: 'food',
        tag: 'Food',
        date: new Date('2026-11-06T12:00:00Z'),
        paidBy: [{ user: users.alex, amount }],
        splitMethod: 'equal',
        splitBetween: [{ user: users.alex }, { user: users.sam }, { user: users.priya }],
      },
      users.alex,
    );
  provider.send.mockReset();
  provider.send.mockImplementation(async (_message, _signal, authorize) =>
    (await authorize()) ? 'accepted' : 'ineligible',
  );
  vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'true');
  vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
  vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', 'true');
  vi.stubEnv('MOBILE_APP_ENV', 'development');
  vi.stubEnv('NOTIFICATION_DISPATCH_SECRET', secret);
  Object.assign(revisions, { alex: 0, sam: 0, priya: 0 });
  await controls('alex');
  await controls('sam');
  await controls('priya');
});

const crossCurrency = {
  amountPaidMinor: 92500,
  paidCurrency: 'INR',
  appliedRate: '92.5',
  suggestedRate: '92.1',
  rateSource: 'frankfurter',
  rateAsOf: '2026-11-05',
  rateFetchedAt: '2026-11-05T00:15:00.000Z',
  rateKind: 'custom',
};
/** One payment through the single route; Sam pays Alex ₹40 unless told otherwise. */
const record = (
  body: object = { paidBy: users.sam, paidTo: users.alex, amount: 40, currency: 'INR' },
  who: Who = 'sam',
  key: string = randomUUID(),
) =>
  callRoute(single.POST, {
    method: 'POST',
    path: '/api/groups/' + group + '/settlements',
    params: { id: group },
    cookie: cookies[who],
    headers: { 'Idempotency-Key': key },
    body,
  });
/** Sam pays Alex ₹50 of ₹100 and the whole €10 in rupees, as one payment. */
const twoCurrencies = {
  paidBy: users.sam,
  paidTo: users.alex,
  paidCurrency: 'INR',
  settlements: [
    { currency: 'INR', amount: 50 },
    {
      currency: 'EUR',
      amount: 10,
      amountPaidMinor: 92500,
      appliedRate: '92.5',
      rateKind: 'custom',
      suggestedRate: '92.1',
      rateSource: 'frankfurter',
      rateAsOf: '2026-11-05',
      rateFetchedAt: '2026-11-05T00:15:00.000Z',
    },
  ],
};
const recordBatch = (body: object = twoCurrencies, who: Who = 'sam', key: string = randomUUID()) =>
  callRoute(batch.POST, {
    method: 'POST',
    path: '/api/groups/' + group + '/settlements/batch',
    params: { id: group },
    cookie: cookies[who],
    headers: { 'Idempotency-Key': key },
    body,
  });
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
const paymentRecipients = () =>
  sent('settlement_recorded')
    .map((envelope) => envelope.accountId)
    .sort();
const paymentContexts = async () =>
  (await activities().find({ type: 'settlement_recorded' }).sort({ _id: 1 }).toArray()).map(
    (event) => event.notificationContext,
  );
const privateDetail = /Fictional|dinner|amount|token|Alex|Sam|Priya|INR|EUR|₹|€|rate|note/;

describe('Payment alerts for single, batch and Cross-currency Settlements (#842)', () => {
  it('a single recording alerts the other payer or recipient, never the member who recorded it or anyone else', async () => {
    const saved = await record();
    expect(saved.status).toBe(201);
    const settlementId = String(saved.body.data._id);
    expect(paymentRecipients()).toEqual([users.alex]);
    const [context] = await paymentContexts();
    expect(context).toMatchObject({
      version: 2,
      kind: 'settlement_recorded',
      groupId: group,
      recordId: settlementId,
      recipientIds: [users.alex],
    });
    expect(sent('settlement_recorded')[0]).toMatchObject({
      recordId: settlementId,
      eventId: String(context.eventId),
    });
    const message = provider.send.mock.calls.at(-1)![0] as { data: Record<string, string> };
    // Data-only, as Expense alerts are (#968): the envelope alone, no ledger details.
    expect(Object.keys(message.data)).toEqual(['body']);
    expect(JSON.stringify(message.data)).not.toMatch(privateDetail);

    // The recipient may record it too (Alex records that Sam paid): the payer is alerted.
    provider.send.mockClear();
    expect(
      (await record({ paidBy: users.sam, paidTo: users.alex, amount: 10, currency: 'INR' }, 'alex'))
        .status,
    ).toBe(201);
    expect(paymentRecipients()).toEqual([users.sam]);

    // Public reads and the save's own answer carry no private context.
    for (const [route, path] of [
      [activity.GET, '/api/groups/' + group + '/activity'],
      [single.GET, '/api/groups/' + group + '/settlements'],
    ] as const) {
      const read = await callRoute(route, {
        method: 'GET',
        path,
        params: { id: group },
        cookie: cookies.priya,
      });
      expect(read.status).toBe(200);
      expect(JSON.stringify(read.body)).not.toMatch(/notificationContext|recipientIds/);
    }
    const home = await callRoute(homeActivity.GET, {
      method: 'GET',
      path: '/api/user/activity',
      cookie: cookies.alex,
    });
    expect(JSON.stringify(home.body)).not.toMatch(/notificationContext|recipientIds/);
    expect(JSON.stringify(saved.body)).not.toMatch(
      /notificationContext|recipientIds|pendingActivity/,
    );
    expect(await Activity.findOne({ type: 'settlement_recorded' }).lean()).not.toHaveProperty(
      'notificationContext',
    );
  });

  it('a Cross-currency single recording alerts the same way, with no rate or currency in the alert', async () => {
    const saved = await record({
      paidBy: users.sam,
      paidTo: users.alex,
      amount: 10,
      currency: 'EUR',
      ...crossCurrency,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({
      currency: 'EUR',
      paidCurrency: 'INR',
      amountPaidMinor: 92500,
    });
    expect(paymentRecipients()).toEqual([users.alex]);
    const message = provider.send.mock.calls.at(-1)![0] as { data: Record<string, string> };
    expect(JSON.stringify(message.data)).not.toMatch(privateDetail);
  });

  it('an idempotent retry keeps one Settlement, one event and one delivery identity', async () => {
    const key = randomUUID();
    const first = await record(undefined, 'sam', key);
    expect(first.status).toBe(201);
    // The reply was lost: the app sends the same key and body again.
    const retry = await record(undefined, 'sam', key);
    expect(retry.status).toBe(201);
    expect(String(retry.body.data._id)).toBe(String(first.body.data._id));
    await run();
    await run();
    expect(await settlements().countDocuments()).toBe(1);
    expect(await activities().countDocuments({ type: 'settlement_recorded' })).toBe(1);
    expect(sent('settlement_recorded')).toHaveLength(1);
    const [context] = await paymentContexts();
    expect(await deliveries().countDocuments({ eventId: String(context.eventId) })).toBe(1);
  });

  it('a batch alerts once per committed Settlement, with no batch-level event, and its replay adds nothing', async () => {
    const key = randomUUID();
    const eventsBefore = await activities().countDocuments();
    const saved = await recordBatch(twoCurrencies, 'sam', key);
    expect(saved.status).toBe(201);
    const ids = saved.body.data.settlements.map((row: { _id: string }) => String(row._id));
    expect(ids).toHaveLength(2);
    const contexts = await paymentContexts();
    expect(contexts.map((context) => context.recordId).sort()).toEqual([...ids].sort());
    for (const context of contexts) expect(context.recipientIds).toEqual([users.alex]);
    // Each Settlement has its own event identity; there is no other event for the batch.
    expect(new Set(contexts.map((context) => context.eventId)).size).toBe(2);
    expect(await activities().countDocuments()).toBe(eventsBefore + 2);
    expect(
      sent('settlement_recorded')
        .map((envelope) => envelope.recordId)
        .sort(),
    ).toEqual([...ids].sort());
    expect(paymentRecipients()).toEqual([users.alex, users.alex]);
    // A replayed batch answers the same Settlements and alerts nothing new.
    const replay = await recordBatch(twoCurrencies, 'sam', key);
    expect(replay.status).toBe(201);
    await run();
    await run();
    expect(await settlements().countDocuments()).toBe(2);
    expect(await activities().countDocuments({ type: 'settlement_recorded' })).toBe(2);
    expect(sent('settlement_recorded')).toHaveLength(2);
    expect(sent()).toHaveLength(2);
    expect(await activities().countDocuments()).toBe(eventsBefore + 2);
  });

  it('a batch refused part-way records nothing and alerts nothing', async () => {
    // No one owes in yen: the JPY row is refused after the INR row was written in the same commit.
    const refused = await recordBatch({
      ...twoCurrencies,
      settlements: [
        { currency: 'INR', amount: 20 },
        {
          currency: 'JPY',
          amount: 100,
          amountPaidMinor: 5500,
          appliedRate: '0.55',
          rateKind: 'custom',
          suggestedRate: '0.55',
          rateSource: 'frankfurter',
          rateAsOf: '2026-11-05',
          rateFetchedAt: '2026-11-05T00:15:00.000Z',
        },
      ],
    });
    expect(refused.status).toBe(422);
    await run();
    expect(await settlements().countDocuments()).toBe(0);
    expect(await activities().countDocuments({ type: 'settlement_recorded' })).toBe(0);
    expect(sent()).toEqual([]);
  });

  it('suggested payments, a refused recording and an uncommitted recording send nothing', async () => {
    const suggested = await callRoute(balances.GET, {
      method: 'GET',
      path: '/api/groups/' + group + '/balances',
      params: { id: group },
      cookie: cookies.sam,
    });
    expect(suggested.status).toBe(200);
    // Priya is neither payer nor recipient: refused.
    expect((await record(undefined, 'priya')).status).toBe(422);
    // The commit itself fails: nothing is recorded.
    const create = vi
      .spyOn(Settlement, 'create')
      .mockRejectedValueOnce(new Error('Simulated commit failure'));
    expect((await record()).status).toBe(500);
    create.mockRestore();
    await run();
    expect(await settlements().countDocuments()).toBe(0);
    expect(await activities().countDocuments({ type: 'settlement_recorded' })).toBe(0);
    expect(sent()).toEqual([]);
  });

  it('a payer or recipient removed from the Group before sending is not alerted', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    expect((await record()).status).toBe(201);
    const [context] = await paymentContexts();
    expect(context.recipientIds).toEqual([users.alex]);
    await removeFromGroup(users.alex);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await run();
    expect(sent()).toEqual([]);
  });

  it('each phone’s Payments switch is independent of its Expense updates switch', async () => {
    // Alex keeps Expense updates and turns Payments off.
    expect(await controls('alex', { expenseUpdates: true, payments: false })).toMatchObject({
      expenseUpdates: true,
      payments: false,
    });
    expect((await record()).status).toBe(201);
    const added = await callRoute(expenses.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/expenses',
      params: { id: group },
      cookie: cookies.sam,
      headers: { 'Idempotency-Key': randomUUID() },
      body: {
        description: 'Fictional taxi',
        amount: 20,
        currency: 'INR',
        category: 'transport',
        tag: 'Transport',
        date: '2026-11-06',
        paidBy: [{ user: users.sam, amount: 20 }],
        splitMethod: 'equal',
        splitBetween: [{ user: users.alex }, { user: users.sam }],
      },
    });
    expect(added.status).toBe(201);
    await run();
    expect(paymentRecipients()).toEqual([]);
    expect(sent('expense_added').map((envelope) => envelope.accountId)).toEqual([users.alex]);

    // Then the other way round: Payments on, Expense updates off. No catch-up of the earlier one.
    provider.send.mockClear();
    expect(await controls('alex', { expenseUpdates: false, payments: true })).toMatchObject({
      expenseUpdates: false,
      payments: true,
    });
    await run();
    expect(sent()).toEqual([]);
    expect(
      (await record({ paidBy: users.sam, paidTo: users.alex, amount: 5, currency: 'INR' })).status,
    ).toBe(201);
    const again = await callRoute(expenses.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/expenses',
      params: { id: group },
      cookie: cookies.sam,
      headers: { 'Idempotency-Key': randomUUID() },
      body: {
        description: 'Fictional bus',
        amount: 10,
        currency: 'INR',
        category: 'transport',
        tag: 'Transport',
        date: '2026-11-06',
        paidBy: [{ user: users.sam, amount: 10 }],
        splitMethod: 'equal',
        splitBetween: [{ user: users.alex }, { user: users.sam }],
      },
    });
    expect(again.status).toBe(201);
    await run();
    expect(paymentRecipients()).toEqual([users.alex]);
    expect(sent('expense_added')).toEqual([]);
  });

  it('turning Expense updates off and on again never resends an already accepted Payment alert', async () => {
    expect((await record()).status).toBe(201);
    expect(paymentRecipients()).toEqual([users.alex]);
    const before = await controls('alex', { expenseUpdates: false });
    const after = await controls('alex', { expenseUpdates: true });
    // Only the Expense generation is renewed; the Payments one is the one already delivered to.
    expect(after.paymentActivation).toBe(before.paymentActivation);
    expect(after.expenseActivation).not.toBe(before.expenseActivation);
    await run();
    await run();
    expect(paymentRecipients()).toEqual([users.alex]);
    expect(await deliveries().countDocuments({ accountId: users.alex })).toBe(1);
  });

  it('a Settlement whose Activity publication was lost is recovered and alerts once', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    const upsert = vi
      .spyOn(Activity, 'updateOne')
      .mockRejectedValueOnce(new Error('Simulated Activity publication outage'));
    const saved = await record();
    upsert.mockRestore();
    expect(saved.status).toBe(201);
    const pending = (await settlements().findOne({}))!.pendingActivity;
    expect(pending).toHaveLength(1);
    expect(pending[0].notificationContext.recipientIds).toEqual([users.alex]);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
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
    expect((await settlements().findOne({}))!.pendingActivity).toEqual([]);
    await run();
    await run();
    expect(paymentRecipients()).toEqual([users.alex]);
  });

  it('with the Payments rollout switch off, recording captures nothing and sends nothing; Expense-added alerts stay as they are', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', '');
    const off = await record();
    expect(off.status).toBe(201);
    expect((await recordBatch()).status).toBe(201);
    await run();
    expect(sent()).toEqual([]);
    expect(await paymentContexts()).toEqual([undefined, undefined, undefined]);
    const added = await callRoute(expenses.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/expenses',
      params: { id: group },
      cookie: cookies.alex,
      headers: { 'Idempotency-Key': randomUUID() },
      body: {
        description: 'Fictional lunch',
        amount: 30,
        currency: 'INR',
        category: 'food',
        tag: 'Food',
        date: '2026-11-06',
        paidBy: [{ user: users.alex, amount: 30 }],
        splitMethod: 'equal',
        splitBetween: [{ user: users.sam }],
      },
    });
    expect(added.status).toBe(201);
    expect(sent().map((envelope) => [envelope.kind, envelope.accountId])).toEqual([
      ['expense_added', users.sam],
    ]);
  });

  it('turning the Payments rollout switch off stops sends of payments captured while it was on', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    expect((await record()).status).toBe(201);
    expect((await paymentContexts())[0].recipientIds).toEqual([users.alex]);
    vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', '');
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await run();
    expect(sent()).toEqual([]);
  });

  it('the recorded money is the same with Payment alerts on as with them off', async () => {
    const stored = async () =>
      (await settlements().find({}).sort({ _id: 1 }).toArray()).map(
        ({
          paidBy,
          paidTo,
          amount,
          amountMinor,
          currency,
          paidCurrency,
          amountPaidMinor,
          appliedRate,
          note,
          createdBy,
        }) => ({
          paidBy: String(paidBy),
          paidTo: String(paidTo),
          amount,
          amountMinor,
          currency,
          paidCurrency,
          amountPaidMinor,
          appliedRate,
          note,
          createdBy: String(createdBy),
        }),
      );
    const journey = async () => {
      expect((await record()).status).toBe(201);
      expect(
        (
          await record(
            {
              paidBy: users.priya,
              paidTo: users.alex,
              amount: 10,
              currency: 'EUR',
              ...crossCurrency,
            },
            'priya',
          )
        ).status,
      ).toBe(201);
      expect((await recordBatch()).status).toBe(201);
      const after = await callRoute(balances.GET, {
        method: 'GET',
        path: '/api/groups/' + group + '/balances',
        params: { id: group },
        cookie: cookies.alex,
      });
      return { settlements: await stored(), balances: after.body.data.byCurrency };
    };
    const on = await journey();
    await settlements().deleteMany({});
    vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', '');
    expect(await journey()).toEqual(on);
  });
});
