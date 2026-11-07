import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
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
import { getAuthDb } from '@/lib/mongodb-client';
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
const db = integrationTestDb('expense-added-notifications');
let expense: typeof import('@/app/api/groups/[id]/expenses/route');
let device: typeof import('@/app/api/notifications/device/route');
let dispatch: typeof import('@/app/api/notifications/dispatch/route');
let activity: typeof import('@/app/api/groups/[id]/activity/route');
let alex: string, sam: string, group: string;
const phone = '00000000-0000-4000-8000-000000000840';
const installationKey = 'private-test-installation-proof-840';
const secret = 'isolated-notification-dispatch-secret-840';
beforeAll(async () => {
  await connectSignedIn(db);
  expense = await import('@/app/api/groups/[id]/expenses/route');
  device = await import('@/app/api/notifications/device/route');
  dispatch = await import('@/app/api/notifications/dispatch/route');
  activity = await import('@/app/api/groups/[id]/activity/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  alex = await signIn('alex');
  sam = await signIn('sam');
  group = String(
    (
      await groupService.create(
        {
          name: 'Fictional alerts',
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
  vi.stubEnv('MOBILE_APP_ENV', 'development');
  vi.stubEnv('NOTIFICATION_DISPATCH_SECRET', secret);
  await callRoute(device.POST, {
    method: 'POST',
    path: '/api/notifications/device',
    cookie: sam,
    body: {
      installationId: phone,
      installationKey,
      revision: 0,
      enabled: true,
      token: 'fictional-private-fcm-token',
    },
  });
});
afterAll(() => disconnectSignedIn(db));
const create = (key = randomUUID()) =>
  callRoute(expense.POST, {
    method: 'POST',
    path: '/api/groups/' + group + '/expenses',
    params: { id: group },
    cookie: alex,
    headers: { 'Idempotency-Key': key },
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
const run = () =>
  callRoute(dispatch.POST, {
    method: 'POST',
    path: '/api/notifications/dispatch',
    cookie: '',
    headers: { authorization: 'Bearer ' + secret },
  });
describe('Expense-added alerts through authenticated HTTP and real MongoDB', () => {
  it('commits one Expense and immutable private involved recipients; repeated request and dispatch send once', async () => {
    const key = randomUUID();
    const saved = await create(key);
    expect(saved.status).toBe(201);
    expect(provider.send).toHaveBeenCalledTimes(1);
    await create(key);
    await run();
    await run();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await mongoose.connection.db!.collection('expenses').countDocuments()).toBe(1);
    const financial = await mongoose.connection.db!.collection('expenses').findOne({});
    expect(financial!.pendingActivity).toEqual([]);
    const event = await mongoose.connection
      .db!.collection('activities')
      .findOne({ type: 'expense_added' });
    expect(event!.notificationContext.recipientIds).toEqual([users.sam]);
    const message = provider.send.mock.calls[0][0] as unknown as {
      data: { title: string; message: string; body: string };
      android: { ttl: string };
    };
    expect(message.data.title).toBe('Splitbook');
    expect(message.data.message).toBe('An Expense was added.');
    const envelope = JSON.parse(message.data.body);
    expect(envelope).toMatchObject({
      version: 2,
      accountId: users.sam,
      groupId: group,
      kind: 'expense_added',
    });
    expect(Date.parse(envelope.expiresAt) - Date.parse(envelope.occurredAt)).toBe(86_400_000);
    expect(JSON.stringify(message.data)).not.toMatch(/Fictional|dinner|amount|sessionId|token/);
    expect(JSON.stringify(saved.body)).not.toMatch(
      /notificationContext|recipientIds|pendingActivity/,
    );
    const publicFeed = await callRoute(activity.GET, {
      method: 'GET',
      path: '/api/groups/' + group + '/activity',
      params: { id: group },
      cookie: sam,
    });
    expect(JSON.stringify(publicFeed.body)).not.toMatch(/notificationContext|recipientIds/);
    expect(await Activity.findOne({ type: 'expense_added' }).lean()).not.toHaveProperty(
      'notificationContext',
    );
  });
  it.each(['membership', 'session', 'switch', 'cutoff', 'expiry'])(
    'rechecks live %s before explicit provider dispatch',
    async (reason) => {
      vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
      expect((await create()).status).toBe(201);
      const registrations = getAuthDb().collection('notificationRegistrations');
      if (reason === 'membership')
        await mongoose.connection
          .db!.collection('groups')
          .updateOne({ _id: new mongoose.Types.ObjectId(group) }, {
            $pull: { members: { user: new mongoose.Types.ObjectId(users.sam) } },
          } as never);
      if (reason === 'session')
        await getAuthDb()
          .collection('sessions')
          .deleteMany({ userId: new mongoose.Types.ObjectId(users.sam) });
      if (reason === 'switch')
        await registrations.updateMany({}, { $set: { expenseUpdates: false } });
      if (reason === 'cutoff')
        await registrations.updateMany(
          {},
          { $set: { expenseCutoff: new Date(Date.now() + 1000) } },
        );
      if (reason === 'expiry')
        await registrations.updateMany({}, { $set: { expiresAt: new Date(0) } });
      vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
      await run();
      expect(provider.send).not.toHaveBeenCalled();
    },
  );
  it('preparing and reviewing a Draft sends nothing; saving its reviewed revision alerts once', async () => {
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
    const drafts = await import('@/app/api/groups/[id]/drafts/route');
    const review = await import('@/app/api/groups/[id]/drafts/review/route');
    const save = await import('@/app/api/groups/[id]/drafts/save/route');
    const storedGroup = await mongoose.connection
      .db!.collection('groups')
      .findOne({ _id: new mongoose.Types.ObjectId(group) });
    const tagId = String(
      storedGroup!.tags.find((tag: { name: string }) => tag.name === 'Food')._id,
    );
    const prepared = await callRoute(drafts.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/drafts',
      params: { id: group },
      cookie: alex,
      headers: { 'Idempotency-Key': randomUUID() },
      body: {
        drafts: [
          {
            description: 'Private reviewed meal',
            amount: 100,
            currency: 'INR',
            category: 'food',
            date: '2026-11-06',
            tagId,
            paidBy: [{ user: users.alex, amount: 100 }],
            splitMethod: 'equal',
            splitBetween: [{ user: users.sam }],
          },
        ],
      },
    });
    expect(prepared.status).toBe(201);
    const id = prepared.body.data[0].id;
    const reviewed = await callRoute(review.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/drafts/review',
      params: { id: group },
      cookie: alex,
      body: { ids: [id] },
    });
    expect(reviewed.status).toBe(200);
    expect(provider.send).not.toHaveBeenCalled();
    const row = reviewed.body.data[0];
    const command = { drafts: [{ id, revision: row.draft.revision, review: row.review }] };
    const saved = await callRoute(save.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/drafts/save',
      params: { id: group },
      cookie: alex,
      body: command,
    });
    expect(saved.body.data[0].status).toBe('saved');
    await callRoute(save.POST, {
      method: 'POST',
      path: '/api/groups/' + group + '/drafts/save',
      params: { id: group },
      cookie: alex,
      body: command,
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(
      (await mongoose.connection.db!.collection('expenses').findOne({}))!.pendingActivity,
    ).toEqual([]);
  });
  it('provider failure cannot change the financial result or retain pending Activity', async () => {
    provider.send.mockResolvedValue('temporary');
    expect((await create()).status).toBe(201);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(
      (await mongoose.connection.db!.collection('expenses').findOne({}))!.pendingActivity,
    ).toEqual([]);
    expect(
      await mongoose.connection
        .db!.collection('activities')
        .countDocuments({ type: 'expense_added' }),
    ).toBe(1);
  });
  it('legacy events without a captured context never become eligible', async () => {
    await mongoose.connection.db!.collection('activities').insertOne({
      group: new mongoose.Types.ObjectId(group),
      actor: new mongoose.Types.ObjectId(users.alex),
      type: 'expense_added',
      createdAt: new Date(),
      metadata: { expenseId: new mongoose.Types.ObjectId().toHexString() },
    });
    await run();
    expect(provider.send).not.toHaveBeenCalled();
  });
  it('explicit bounded pages reach a new event after one hundred accepted events', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    for (let index = 0; index < 101; index++) expect((await create()).status).toBe(201);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await run();
    await run();
    expect(provider.send).toHaveBeenCalledTimes(101);
  }, 60_000);
  it('keeps pre-send budget exhaustion pending for the next explicit dispatch', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await create();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    const realNow = Date.now.bind(Date);
    let offset = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
      offset = 11_000;
      return (await authorize()) ? 'accepted' : 'ineligible';
    });
    try {
      expect((await run()).body.data.accepted).toBe(0);
      offset = 0;
      expect((await run()).body.data.accepted).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('does not resend an accepted Expense when only Payments is re-enabled', async () => {
    await create();
    for (const [revision, payments] of [
      [1, false],
      [2, true],
    ] as const)
      expect(
        (
          await callRoute(device.POST, {
            method: 'POST',
            path: '/api/notifications/device',
            cookie: sam,
            body: {
              installationId: phone,
              installationKey,
              revision,
              enabled: true,
              expenseUpdates: true,
              payments,
            },
          })
        ).status,
      ).toBe(200);
    await run();
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it('overlapping explicit invocations accept one send for the same device event', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await create();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    const results = await Promise.all([run(), run()]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it('never resends an uncertain provider outcome', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await create();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
      expect(await authorize()).toBe(true);
      return 'uncertain';
    });
    await run();
    await run();
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await getAuthDb().collection('notificationDeliveries').findOne({})).toMatchObject({
      state: 'uncertain',
    });
  });
  it('Home, financial lean reads and JSON backup expose no private notification context', async () => {
    await create();
    const home = await import('@/app/api/user/activity/route');
    const backup = await import('@/app/api/export/route');
    for (const result of [
      await callRoute(home.GET, { method: 'GET', path: '/api/user/activity', cookie: sam }),
      await callRoute(expense.GET, {
        method: 'GET',
        path: '/api/groups/' + group + '/expenses',
        params: { id: group },
        cookie: sam,
      }),
      await callRoute(backup.GET, {
        method: 'GET',
        path: '/api/export?groups=' + group + '&format=json&include=history',
        cookie: sam,
      }),
    ]) {
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).not.toMatch(
        /notificationContext|recipientIds|pendingActivity|fictional-private-fcm-token/,
      );
    }
  });
  it('dispatches the immutable creation audience even after the Expense participants change', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    const created = await create();
    const expenseId = created.body.data._id;
    const item = await import('@/app/api/groups/[id]/expenses/[expenseId]/route');
    const edited = await callRoute(item.PATCH, {
      method: 'PATCH',
      path: '/api/groups/' + group + '/expenses/' + expenseId,
      params: { id: group, expenseId },
      cookie: alex,
      headers: { 'X-Splitbook-Revision': '0' },
      body: { paidBy: [{ user: users.priya, amount: 100 }], splitBetween: [{ user: users.priya }] },
    });
    expect(edited.status).toBe(200);
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await run();
    expect(provider.send).toHaveBeenCalledTimes(1);
    const message = provider.send.mock.calls[0][0] as { data: { body: string } };
    expect(JSON.parse(message.data.body).accountId).toBe(users.sam);
    const event = await mongoose.connection
      .db!.collection('activities')
      .findOne({ type: 'expense_added' });
    expect(event!.notificationContext.recipientIds).toEqual([users.sam]);
  });
  it('invalid-token disable advances the device revision and refuses a stale category update', async () => {
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
      expect(await authorize()).toBe(true);
      return 'invalid-token';
    });
    await create();
    const current = await callRoute(device.GET, {
      method: 'GET',
      path: '/api/notifications/device?installationId=' + phone,
      cookie: sam,
      headers: { 'X-Installation-Key': installationKey },
    });
    expect(current.body.data).toMatchObject({ enabled: false, revision: 2 });
    const stale = await callRoute(device.POST, {
      method: 'POST',
      path: '/api/notifications/device',
      cookie: sam,
      body: {
        installationId: phone,
        installationKey,
        revision: 1,
        enabled: true,
        expenseUpdates: true,
        payments: false,
      },
    });
    expect(stale.status).toBe(409);
    await run();
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it.each(['claimed', 'sending'] as const)(
    'handles an expired %s lease without excluding recoverable work or repeating provider I/O',
    async (phase) => {
      provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
        if (phase === 'sending') expect(await authorize()).toBe(true);
        throw new Error('Simulated process loss at external provider boundary');
      });
      expect((await create()).status).toBe(201);
      const deliveries = getAuthDb().collection('notificationDeliveries');
      expect(await deliveries.findOne({})).toMatchObject({ state: phase });
      await deliveries.updateMany({}, { $set: { leaseUntil: new Date(0) } });
      await run();
      expect(provider.send).toHaveBeenCalledTimes(phase === 'claimed' ? 2 : 1);
      expect(await deliveries.findOne({})).toMatchObject({
        state: phase === 'claimed' ? 'accepted' : 'uncertain',
      });
      expect((await run()).body.data).toMatchObject({ considered: 0, accepted: 0 });
    },
  );
  it('continues bounded fanout beyond one hundred installations for the same Expense', async () => {
    for (let index = 0; index < 100; index++) {
      const registered = await callRoute(device.POST, {
        method: 'POST',
        path: '/api/notifications/device',
        cookie: sam,
        body: {
          installationId: randomUUID(),
          installationKey,
          revision: 0,
          enabled: true,
          token: 'fictional-fanout-token-' + index,
        },
      });
      expect(registered.status).toBe(200);
    }
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await create();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await run();
    await run();
    expect(provider.send).toHaveBeenCalledTimes(101);
    const exhausted = await run();
    expect(exhausted.body.data).toMatchObject({ considered: 0, accepted: 0 });
    expect(provider.send).toHaveBeenCalledTimes(101);
  }, 60_000);
  it('explicit dispatcher denies missing credentials and caller-selected scope', async () => {
    expect(
      (
        await callRoute(dispatch.POST, {
          method: 'POST',
          path: '/api/notifications/dispatch',
          cookie: '',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await callRoute(dispatch.POST, {
          method: 'POST',
          path: '/api/notifications/dispatch?group=private',
          cookie: '',
          headers: { authorization: 'Bearer ' + secret },
        })
      ).status,
    ).toBe(400);
  });
});
describe('a registration follows its live session (#840)', () => {
  const day = 86_400_000;
  const readControls = () =>
    callRoute(device.GET, {
      method: 'GET',
      path: '/api/notifications/device?installationId=' + phone,
      cookie: sam,
      headers: { 'X-Installation-Key': installationKey },
    });
  const readFeed = (cookie: string) =>
    callRoute(activity.GET, {
      method: 'GET',
      path: '/api/groups/' + group + '/activity',
      params: { id: group },
      cookie,
    });
  afterEach(() => vi.useRealTimers());
  it('a session renewed past its first expiry still gets sends, and its controls still read as on', async () => {
    const registeredAt = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    // Day 29.5: both members use the app (not Settings), so Better Auth renews their sessions.
    vi.setSystemTime(registeredAt + 29.5 * day);
    expect((await readFeed(sam)).status).toBe(200);
    expect((await readFeed(alex)).status).toBe(200);
    // Day 31: past the session's first expiry.
    vi.setSystemTime(registeredAt + 31 * day);
    const registration = await getAuthDb().collection('notificationRegistrations').findOne({});
    expect(registration!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await create()).status).toBe(201);
    await run();
    expect(provider.send).toHaveBeenCalledTimes(1);
    const controls = await readControls();
    expect(controls.status).toBe(200);
    expect(controls.body.data).toMatchObject({ enabled: true, expenseUpdates: true });
  });
  it('an expired session gets no sends and its controls do not read as on', async () => {
    const registeredAt = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(registeredAt + 29.5 * day);
    expect((await readFeed(alex)).status).toBe(200);
    vi.setSystemTime(registeredAt + 31 * day);
    expect((await create()).status).toBe(201);
    await run();
    expect(provider.send).not.toHaveBeenCalled();
    expect((await readControls()).status).toBe(401);
  });
});
