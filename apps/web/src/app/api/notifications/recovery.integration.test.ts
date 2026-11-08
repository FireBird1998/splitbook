/**
 * Autonomous 24-hour alert recovery (#843), through the normal authenticated routes against a
 * real MongoDB replica set. Only the Google transport (`sendFcm`) is substituted. Each journey
 * records a change with an ordinary member request, interrupts its notification path, leaves
 * every client alone (no Group or Home Activity read), and then calls the protected
 * `POST /api/notifications/dispatch` trigger the external five-minute scheduler would call.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { DEMO_PERSONA_IDS as users } from '@/lib/demo-personas';
import Activity from '@/lib/models/Activity';
import { getAuthDb } from '@/lib/mongodb-client';
vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);
type Outcome = string | { outcome: 'temporary'; retryAfterMs: number };
const provider = vi.hoisted(() => ({
  send: vi.fn(
    async (
      _message: unknown,
      _signal: AbortSignal,
      authorize: () => Promise<boolean>,
    ): Promise<Outcome> => ((await authorize()) ? 'accepted' : 'ineligible'),
  ),
}));
vi.mock('@/lib/notifications/provider', () => ({ sendFcm: provider.send }));
const db = integrationTestDb('notification-recovery');
let expenses: typeof import('@/app/api/groups/[id]/expenses/route');
let item: typeof import('@/app/api/groups/[id]/expenses/[expenseId]/route');
let settlements: typeof import('@/app/api/groups/[id]/settlements/route');
let device: typeof import('@/app/api/notifications/device/route');
let dispatch: typeof import('@/app/api/notifications/dispatch/route');
type Who = 'alex' | 'sam' | 'priya';
let cookies: Record<Who, string>;
let group: string;
const secret = 'isolated-notification-dispatch-secret-843';
const installationKey = 'private-test-installation-proof-843';
const phones = {
  alex: '00000000-0000-4000-8000-000000000a43',
  sam: '00000000-0000-4000-8000-000000000b43',
  priya: '00000000-0000-4000-8000-000000000c43',
} as const;
const minute = 60_000;
const hour = 60 * minute;
const expensesCollection = () => mongoose.connection.db!.collection('expenses');
const settlementsCollection = () => mongoose.connection.db!.collection('settlements');
const activities = () => mongoose.connection.db!.collection('activities');
const deliveries = () => getAuthDb().collection('notificationDeliveries');
const registrations = () => getAuthDb().collection('notificationRegistrations');

beforeAll(async () => {
  await connectSignedIn(db);
  await requireReplicaSet();
  expenses = await import('@/app/api/groups/[id]/expenses/route');
  item = await import('@/app/api/groups/[id]/expenses/[expenseId]/route');
  settlements = await import('@/app/api/groups/[id]/settlements/route');
  device = await import('@/app/api/notifications/device/route');
  dispatch = await import('@/app/api/notifications/dispatch/route');
});
afterAll(() => disconnectSignedIn(db));
afterEach(() => vi.useRealTimers());

async function optIn(who: Who) {
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
          name: 'Fictional recovery',
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
  vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', 'true');
  vi.stubEnv('ANDROID_NOTIFICATION_RECOVERY_ENABLED', 'true');
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
const patch = (expenseId: string, body: object, revision: number) =>
  callRoute(item.PATCH, {
    method: 'PATCH',
    path: '/api/groups/' + group + '/expenses/' + expenseId,
    params: { id: group, expenseId },
    cookie: cookies.alex,
    headers: { 'X-Splitbook-Revision': String(revision) },
    body,
  });
const remove = (expenseId: string, revision: number) =>
  callRoute(item.DELETE, {
    method: 'DELETE',
    path: '/api/groups/' + group + '/expenses/' + expenseId,
    params: { id: group, expenseId },
    cookie: cookies.alex,
    headers: { 'X-Splitbook-Revision': String(revision) },
  });
/** Sam pays Alex ₹40 through the single Settlement route. */
const recordPayment = () =>
  callRoute(settlements.POST, {
    method: 'POST',
    path: '/api/groups/' + group + '/settlements',
    params: { id: group },
    cookie: cookies.sam,
    headers: { 'Idempotency-Key': randomUUID() },
    body: { paidBy: users.sam, paidTo: users.alex, amount: 40, currency: 'INR' },
  });
/** The protected trigger, exactly as the external scheduler calls it. */
const trigger = () =>
  callRoute(dispatch.POST, {
    method: 'POST',
    path: '/api/notifications/dispatch',
    cookie: '',
    headers: { authorization: 'Bearer ' + secret },
  });
/** Interrupts Activity publication once, as a lost post-commit step would. */
const losePublication = () =>
  vi
    .spyOn(Activity, 'updateOne')
    .mockRejectedValueOnce(new Error('Simulated Activity publication outage'));
const envelopes = () =>
  provider.send.mock.calls.map((call) =>
    JSON.parse((call[0] as { data: { body: string } }).data.body),
  );
const sentTo = () => envelopes().map((envelope) => envelope.accountId);
/** Moves the server's clock forward while real time keeps running. */
function clock() {
  const start = Date.now();
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  return { at: (offset: number) => vi.setSystemTime(start + offset) };
}

describe('recovering an interrupted change with no app open (#843)', () => {
  it('a change whose Activity publication was lost, with no client reading anything, is recovered by the trigger and alerts once', async () => {
    const upsert = losePublication();
    const expenseId = await createExpense();
    upsert.mockRestore();
    // The interruption: no Activity, the intent still pending, nothing sent.
    expect(await activities().countDocuments({ type: 'expense_added' })).toBe(0);
    expect((await expensesCollection().findOne({}))!.pendingActivity).toHaveLength(1);
    expect(provider.send).not.toHaveBeenCalled();

    const first = await trigger();
    expect(first.status).toBe(200);
    expect(sentTo()).toEqual([users.sam]);
    expect(envelopes()[0]).toMatchObject({
      version: 2,
      kind: 'expense_added',
      groupId: group,
      recordId: expenseId,
      environment: 'development',
    });
    expect(first.body.data).toMatchObject({ recovered: 1, accepted: 1 });
    // Publication acknowledged the intent; a replayed trigger sends nothing more.
    expect((await expensesCollection().findOne({}))!.pendingActivity).toEqual([]);
    expect(await activities().countDocuments({ type: 'expense_added' })).toBe(1);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it.each(['expense_updated', 'expense_deleted', 'settlement_recorded'] as const)(
    '%s whose Activity publication was lost is recovered without a Group read',
    async (kind) => {
      vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
      const expenseId = await createExpense();
      vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
      await trigger();
      provider.send.mockClear();
      const upsert = losePublication();
      if (kind === 'expense_updated')
        expect((await patch(expenseId, { description: 'Fictional edit' }, 0)).status).toBe(200);
      if (kind === 'expense_deleted') expect((await remove(expenseId, 0)).status).toBe(200);
      if (kind === 'settlement_recorded') expect((await recordPayment()).status).toBe(201);
      upsert.mockRestore();
      expect(await activities().countDocuments({ type: kind })).toBe(0);
      expect(provider.send).not.toHaveBeenCalled();
      await trigger();
      expect(envelopes().map((envelope) => envelope.kind)).toEqual([kind]);
      expect(sentTo()).toEqual([kind === 'settlement_recorded' ? users.alex : users.sam]);
      const source =
        kind === 'settlement_recorded' ? settlementsCollection() : expensesCollection();
      for (const record of await source.find({}).toArray())
        expect(record.pendingActivity).toEqual([]);
      await trigger();
      expect(provider.send).toHaveBeenCalledTimes(1);
    },
  );

  it('a provider outage during recovery cannot keep the financial intent pending or change the saved Expense', async () => {
    const upsert = losePublication();
    await createExpense();
    upsert.mockRestore();
    const before = await expensesCollection().findOne({}, { projection: { pendingActivity: 0 } });
    provider.send.mockImplementation(async (_message, _signal, authorize) =>
      (await authorize()) ? 'temporary' : 'ineligible',
    );
    expect((await trigger()).status).toBe(200);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect((await expensesCollection().findOne({}))!.pendingActivity).toEqual([]);
    expect(await expensesCollection().findOne({}, { projection: { pendingActivity: 0 } })).toEqual(
      before,
    );
  });
});

describe('retrying definite temporary failures (#843)', () => {
  /** One accepted-or-not Expense-added send to Sam, made while sends were paused. */
  async function pausedExpense() {
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await createExpense();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
  }
  it('retries after its jittered backoff and never again once accepted', async () => {
    const time = clock();
    await pausedExpense();
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
      (await authorize()) ? 'temporary' : 'ineligible',
    );
    expect((await trigger()).body.data).toMatchObject({ failed: 1, retrying: 1 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    const scheduled = (await deliveries().findOne({}))!;
    expect(scheduled).toMatchObject({ state: 'temporary', attempts: 1 });
    // The first backoff is 30 to 60 seconds: jittered, bounded.
    const wait = scheduled.nextAttemptAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(25_000);
    expect(wait).toBeLessThanOrEqual(60_000);
    time.at(20_000);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(1);
    time.at(61_000);
    expect((await trigger()).body.data).toMatchObject({ accepted: 1 });
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(await deliveries().findOne({})).toMatchObject({ state: 'accepted', attempts: 2 });
    time.at(2 * hour);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('honours a longer Retry-After from the provider', async () => {
    const time = clock();
    await pausedExpense();
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
      (await authorize()) ? { outcome: 'temporary', retryAfterMs: 10 * minute } : 'ineligible',
    );
    await trigger();
    time.at(5 * minute);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(1);
    time.at(10 * minute + 1_000);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(2);
  });

  it('gives up after five attempts', async () => {
    const time = clock();
    await pausedExpense();
    provider.send.mockImplementation(async (_message, _signal, authorize) =>
      (await authorize()) ? 'temporary' : 'ineligible',
    );
    for (let step = 1; step <= 8; step++) {
      time.at(step * hour);
      await trigger();
    }
    expect(provider.send).toHaveBeenCalledTimes(5);
    expect(await deliveries().findOne({})).toMatchObject({
      state: 'temporary',
      attempts: 5,
      nextAttemptAt: null,
    });
  });

  it('an operational (credential or payload) failure and an uncertain send are never retried', async () => {
    const time = clock();
    await pausedExpense();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await createExpense();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    provider.send
      .mockImplementationOnce(async (_message, _signal, authorize) =>
        (await authorize()) ? 'operational' : 'ineligible',
      )
      .mockImplementationOnce(async (_message, _signal, authorize) =>
        (await authorize()) ? 'uncertain' : 'ineligible',
      );
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(2);
    time.at(3 * hour);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect((await deliveries().find({}).toArray()).map((row) => row.state).sort()).toEqual([
      'operational',
      'uncertain',
    ]);
  });

  it('an invalid token disables its binding and the retry never reaches it', async () => {
    const time = clock();
    await pausedExpense();
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
      (await authorize()) ? 'invalid-token' : 'ineligible',
    );
    await trigger();
    expect(await registrations().findOne({ installationId: phones.sam })).toMatchObject({
      enabled: false,
    });
    time.at(hour);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('a send process lost after dispatch becomes uncertain when its lease ends, and is not resent', async () => {
    const time = clock();
    await pausedExpense();
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
      expect(await authorize()).toBe(true);
      throw new Error('Simulated process loss during the provider request');
    });
    expect((await trigger()).status).toBe(503);
    expect(await deliveries().findOne({})).toMatchObject({ state: 'sending' });
    time.at(5 * minute);
    await trigger();
    expect(await deliveries().findOne({})).toMatchObject({ state: 'uncertain' });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('a claim lost before any provider I/O is reclaimed after its lease, on a page the cursor has passed', async () => {
    const time = clock();
    await pausedExpense();
    provider.send.mockImplementationOnce(async () => {
      throw new Error('Simulated process loss before the provider request');
    });
    expect((await trigger()).status).toBe(503);
    expect(await deliveries().findOne({})).toMatchObject({ state: 'claimed' });
    // While its lease runs, the next run passes over it and moves the cursor beyond it.
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(1);
    // A newer event keeps the cursor's next page busy, so only recovery revisits the old claim.
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await createExpense();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    time.at(5 * minute);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect((await deliveries().find({}).toArray()).map((row) => row.state)).toEqual([
      'accepted',
      'accepted',
    ]);
  });
});

describe('every attempt rechecks expiry, access, session, binding, switch and activation (#843)', () => {
  it('a temporary failure whose retry falls after the 24 hours is never sent; the provider TTL is the remaining lifetime', async () => {
    const time = clock();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await createExpense();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    time.at(23 * hour + 59 * minute);
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
      (await authorize()) ? 'temporary' : 'ineligible',
    );
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(1);
    const ttl = (provider.send.mock.calls[0][0] as { android: { ttl: string } }).android.ttl;
    expect(Number.parseInt(ttl, 10)).toBeLessThanOrEqual(60);
    time.at(24 * hour + minute);
    await trigger();
    expect(provider.send).toHaveBeenCalledTimes(1);
    // Expiry is enforced by the query, before the TTL index cleans the row up.
    expect(await deliveries().countDocuments()).toBe(1);
  });

  it.each(['membership', 'session', 'switch', 'activation', 'kill switch'])(
    'after a temporary failure, a %s change before the retry stops it',
    async (change) => {
      const time = clock();
      vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
      await createExpense();
      vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
      provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
        (await authorize()) ? 'temporary' : 'ineligible',
      );
      await trigger();
      expect(provider.send).toHaveBeenCalledTimes(1);
      if (change === 'membership')
        await mongoose.connection
          .db!.collection('groups')
          .updateOne({ _id: new mongoose.Types.ObjectId(group) }, {
            $pull: { members: { user: new mongoose.Types.ObjectId(users.sam) } },
          } as never);
      if (change === 'session')
        await getAuthDb()
          .collection('sessions')
          .deleteMany({ userId: new mongoose.Types.ObjectId(users.sam) });
      if (change === 'switch')
        await registrations().updateMany(
          { installationId: phones.sam },
          { $set: { expenseUpdates: false } },
        );
      if (change === 'activation') {
        // Off and on again: a new activation generation and cutoff, so no catch-up.
        for (const [revision, enabled] of [
          [1, false],
          [2, true],
        ] as const)
          expect(
            (
              await callRoute(device.POST, {
                method: 'POST',
                path: '/api/notifications/device',
                cookie: cookies.sam,
                body: { installationId: phones.sam, installationKey, revision, enabled },
              })
            ).status,
          ).toBe(200);
      }
      if (change === 'kill switch') vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
      time.at(hour);
      await trigger();
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect((await deliveries().find({}).toArray()).every((row) => row.state !== 'accepted')).toBe(
        true,
      );
    },
  );

  it('an unpublished change recovered after its recipient left the Group sends nothing', async () => {
    const upsert = losePublication();
    await createExpense();
    upsert.mockRestore();
    await mongoose.connection
      .db!.collection('groups')
      .updateOne({ _id: new mongoose.Types.ObjectId(group) }, {
        $pull: { members: { user: new mongoose.Types.ObjectId(users.sam) } },
      } as never);
    await trigger();
    expect(provider.send).not.toHaveBeenCalled();
    expect((await expensesCollection().findOne({}))!.pendingActivity).toEqual([]);
  });
});

describe('overlapping scheduler invocations (#843)', () => {
  it('three overlapping triggers recover one lost change and send it once', async () => {
    const upsert = losePublication();
    await createExpense();
    upsert.mockRestore();
    provider.send.mockImplementation(async (_message, _signal, authorize) => {
      if (!(await authorize())) return 'ineligible';
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'accepted';
    });
    const results = await Promise.all([trigger(), trigger(), trigger()]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(sentTo()).toEqual([users.sam]);
    expect(await activities().countDocuments({ type: 'expense_added' })).toBe(1);
  });

  it('overlapping triggers retry one due temporary failure once', async () => {
    const time = clock();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await createExpense();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
      (await authorize()) ? 'temporary' : 'ineligible',
    );
    await trigger();
    provider.send.mockImplementation(async (_message, _signal, authorize) => {
      if (!(await authorize())) return 'ineligible';
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'accepted';
    });
    time.at(hour);
    await Promise.all([trigger(), trigger(), trigger()]);
    expect(provider.send).toHaveBeenCalledTimes(2);
  });
});

describe('the recovery kill switch and bounds (#843)', () => {
  it('with ANDROID_NOTIFICATION_RECOVERY_ENABLED unset the trigger publishes nothing and retries nothing, as before #843', async () => {
    vi.stubEnv('ANDROID_NOTIFICATION_RECOVERY_ENABLED', undefined);
    const time = clock();
    const upsert = losePublication();
    await createExpense();
    upsert.mockRestore();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    await createExpense();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
      (await authorize()) ? 'temporary' : 'ineligible',
    );
    expect((await trigger()).status).toBe(200);
    expect(provider.send).toHaveBeenCalledTimes(1);
    time.at(hour);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const again = await trigger();
      expect(again.body.data).toMatchObject({ considered: 0, recovered: 0, retrying: 0 });
      // The log line is exactly the one production already reads.
      expect(log.mock.calls.map((call) => call.join(' '))).toEqual([
        'Notification dispatch: considered=0 accepted=0 skipped=0 uncertain=0 failed=0',
      ]);
    } finally {
      log.mockRestore();
    }
    expect(provider.send).toHaveBeenCalledTimes(1);
    // The lost publication is still pending: only a Group read or the switch recovers it.
    const pending = await expensesCollection()
      .find({ 'pendingActivity.0': { $exists: true } })
      .toArray();
    expect(pending).toHaveLength(1);
  });

  it('with sends paused, the trigger recovers and sends nothing; resuming delivers late', async () => {
    const upsert = losePublication();
    await createExpense();
    upsert.mockRestore();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    expect((await trigger()).body.data).toMatchObject({ considered: 0, accepted: 0 });
    expect(await deliveries().countDocuments()).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
    await trigger();
    expect(sentTo()).toEqual([users.sam]);
  });

  it('one invocation recovers at most 100 events and considers at most 100 deliveries; the next continues', async () => {
    const upsert = vi
      .spyOn(Activity, 'updateOne')
      .mockRejectedValue(new Error('Simulated Activity publication outage'));
    for (let index = 0; index < 101; index++) await createExpense();
    upsert.mockRestore();
    const first = await trigger();
    expect(first.body.data.recovered).toBeGreaterThan(0);
    expect(first.body.data.recovered).toBeLessThanOrEqual(100);
    expect(first.body.data.considered).toBeLessThanOrEqual(100);
    expect(provider.send.mock.calls.length).toBeLessThanOrEqual(100);
    for (let run = 0; run < 6 && provider.send.mock.calls.length < 101; run++) {
      const next = await trigger();
      expect(next.body.data.recovered).toBeLessThanOrEqual(100);
      expect(next.body.data.considered).toBeLessThanOrEqual(100);
    }
    expect(provider.send).toHaveBeenCalledTimes(101);
    expect(
      await expensesCollection().countDocuments({ 'pendingActivity.0': { $exists: true } }),
    ).toBe(0);
  }, 120_000);

  it('the 20-second pass fits inside the hosting timeout', () => {
    expect(dispatch.maxDuration).toBeGreaterThan(20);
    expect(dispatch.maxDuration).toBeLessThanOrEqual(60);
  });

  it('accepts only the dedicated secret, no caller-chosen scope, and answers sanitized counts', async () => {
    const call = (
      headers: Record<string, string>,
      path = '/api/notifications/dispatch',
      body?: unknown,
    ) => callRoute(dispatch.POST, { method: 'POST', path, cookie: '', headers, body });
    expect((await call({})).status).toBe(401);
    expect((await call({ authorization: 'Bearer ' + secret.replace(/3$/, '4') })).status).toBe(401);
    // A signed-in member's session is not the dispatcher capability.
    expect(
      (
        await callRoute(dispatch.POST, {
          method: 'POST',
          path: '/api/notifications/dispatch',
          cookie: cookies.alex,
        })
      ).status,
    ).toBe(401);
    const bearer = { authorization: 'Bearer ' + secret };
    expect((await call(bearer, '/api/notifications/dispatch?eventId=1')).status).toBe(400);
    expect((await call(bearer, undefined, { eventIds: ['x'], groupId: group })).status).toBe(400);
    expect((await call(bearer, undefined, { accountId: users.sam })).status).toBe(400);
    vi.stubEnv('NOTIFICATION_DISPATCH_SECRET', 'too-short');
    expect((await call({ authorization: 'Bearer too-short' })).status).toBe(401);
    vi.stubEnv('NOTIFICATION_DISPATCH_SECRET', secret);
    const upsert = losePublication();
    await createExpense();
    upsert.mockRestore();
    const answered = await call(bearer);
    expect(answered.status).toBe(200);
    expect(Object.keys(answered.body.data).sort()).toEqual(
      ['accepted', 'considered', 'failed', 'recovered', 'retrying', 'skipped'].sort(),
    );
    for (const value of Object.values(answered.body.data)) expect(typeof value).toBe('number');
    expect(JSON.stringify(answered.body)).not.toMatch(
      new RegExp([group, users.sam, phones.sam, 'fictional-private-fcm-token'].join('|')),
    );
  });

  it('logs one counts-only line per recovery run, with the recovery counts appended', async () => {
    const upsert = losePublication();
    await createExpense();
    upsert.mockRestore();
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) =>
      (await authorize()) ? 'temporary' : 'ineligible',
    );
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await trigger();
      const lines = log.mock.calls.map((call) => call.join(' '));
      expect(lines).toEqual([
        'Notification dispatch: considered=1 accepted=0 skipped=0 uncertain=0 failed=1' +
          ' recovered=1 retrying=1',
      ]);
    } finally {
      log.mockRestore();
    }
  });
});
