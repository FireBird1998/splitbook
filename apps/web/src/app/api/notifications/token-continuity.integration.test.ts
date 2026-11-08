import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  APP_URL,
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';
import { groupService } from '@/lib/services/group.service';
import { DEMO_PERSONA_IDS as users } from '@/lib/demo-personas';
import { getAuthDb } from '@/lib/mongodb-client';
vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);
type Message = { token: string; data: { body: string }; android: { ttl: string } };
const provider = vi.hoisted(() => ({
  send: vi.fn(
    async (
      _message: unknown,
      _signal: AbortSignal,
      authorize: () => Promise<boolean>,
    ): Promise<string> => ((await authorize()) ? 'accepted' : 'ineligible'),
  ),
}));
// Only the Google transport is replaced: every other step is the real route and database.
vi.mock('@/lib/notifications/provider', () => ({ sendFcm: provider.send }));
const db = integrationTestDb('notification-token-continuity');
let expense: typeof import('@/app/api/groups/[id]/expenses/route');
let device: typeof import('@/app/api/notifications/device/route');
let dispatch: typeof import('@/app/api/notifications/dispatch/route');
let auth: typeof import('@/lib/auth').auth;
let alex: string, group: string;
const secret = 'isolated-notification-dispatch-secret-844';
/** Sam's two phones: each its own installation, session and token. */
const phoneA = {
  id: '00000000-0000-4000-8000-000000000a44',
  key: 'private-proof-phone-a-0000000844',
};
const phoneB = {
  id: '00000000-0000-4000-8000-000000000b44',
  key: 'private-proof-phone-b-0000000844',
};
type Phone = typeof phoneA;
let samA: string, samB: string;
const sentTokens = () => provider.send.mock.calls.map((call) => (call[0] as Message).token);
const envelopes = () =>
  provider.send.mock.calls.map((call) => JSON.parse((call[0] as Message).data.body));
const controls = (phone: Phone, cookie: string) =>
  callRoute(device.GET, {
    method: 'GET',
    path: '/api/notifications/device?installationId=' + phone.id,
    cookie,
    headers: { 'X-Installation-Key': phone.key },
  });
const post = (phone: Phone, cookie: string, body: Record<string, unknown>) =>
  callRoute(device.POST, {
    method: 'POST',
    path: '/api/notifications/device',
    cookie,
    body: { installationId: phone.id, installationKey: phone.key, ...body },
  });
/** The member's explicit Enable in Settings. */
const enable = async (phone: Phone, cookie: string, token: string) => {
  const revision = (await controls(phone, cookie)).body.data.revision;
  const answer = await post(phone, cookie, { revision, enabled: true, token });
  expect(answer.status).toBe(200);
  return answer.body.data;
};
/** The app's registration maintenance: a new native token under the consent already given. */
const maintain = async (phone: Phone, cookie: string, token: string, revision?: number) =>
  post(phone, cookie, {
    revision: revision ?? (await controls(phone, cookie)).body.data.revision,
    enabled: true,
    token,
    maintenance: true,
  });
const registration = (phone: Phone) =>
  getAuthDb().collection('notificationRegistrations').findOne({ installationId: phone.id });
const signOut = async (cookie: string) => {
  const response = await auth.handler(
    new Request(APP_URL + '/api/auth/sign-out', {
      method: 'POST',
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  expect(response.ok).toBe(true);
};
/** Alex records an Expense that involves `involved`; the dispatch after it runs on response. */
const create = (involved: string[] = [users.sam], cookie = alex) =>
  callRoute(expense.POST, {
    method: 'POST',
    path: '/api/groups/' + group + '/expenses',
    params: { id: group },
    cookie,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      description: 'Fictional private dinner',
      amount: 100,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: '2026-11-06',
      paidBy: [{ user: cookie === alex ? users.alex : users.sam, amount: 100 }],
      splitMethod: 'equal',
      splitBetween: involved.map((user) => ({ user })),
    },
  });
const run = () =>
  callRoute(dispatch.POST, {
    method: 'POST',
    path: '/api/notifications/dispatch',
    cookie: '',
    headers: { authorization: 'Bearer ' + secret },
  });
const pause = () => vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
const resume = () => vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'true');
beforeAll(async () => {
  await connectSignedIn(db);
  expense = await import('@/app/api/groups/[id]/expenses/route');
  device = await import('@/app/api/notifications/device/route');
  dispatch = await import('@/app/api/notifications/dispatch/route');
  ({ auth } = await import('@/lib/auth'));
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  alex = await signIn('alex');
  samA = await signIn('sam');
  samB = await signIn('sam');
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
});
afterAll(() => disconnectSignedIn(db));

describe('token rotation keeps an opted-in phone receiving alerts (#844)', () => {
  it('a rotated token keeps the binding, activation and cutoff; the next Expense reaches it and nothing replays', async () => {
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual(['fictional-token-a1']);
    const rotated = await maintain(phoneA, samA, 'fictional-token-a2');
    expect(rotated.status).toBe(200);
    expect(rotated.body.data).toMatchObject({
      enabled: true,
      expenseUpdates: true,
      payments: true,
      binding: enabled.binding,
      activation: enabled.activation,
      expenseActivation: enabled.expenseActivation,
      expenseCutoff: enabled.expenseCutoff,
      paymentCutoff: enabled.paymentCutoff,
    });
    expect(JSON.stringify(rotated.body)).not.toContain('fictional-token');
    await run();
    expect(sentTokens()).toEqual(['fictional-token-a1']);
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual(['fictional-token-a1', 'fictional-token-a2']);
  });
  it('the same token again writes nothing and keeps the revision', async () => {
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    const again = await maintain(phoneA, samA, 'fictional-token-a1');
    expect(again.status).toBe(200);
    expect(again.body.data.revision).toBe(enabled.revision);
  });
  it('a pending event keeps its original deadline after rotation and an uncertain one is never resent', async () => {
    await enable(phoneA, samA, 'fictional-token-a1');
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
      expect(await authorize()).toBe(true);
      return 'uncertain';
    });
    expect((await create()).status).toBe(201);
    pause();
    expect((await create()).status).toBe(201);
    expect((await maintain(phoneA, samA, 'fictional-token-a2')).status).toBe(200);
    resume();
    await run();
    await run();
    expect(sentTokens()).toEqual(['fictional-token-a1', 'fictional-token-a2']);
    const [, late] = envelopes();
    const event = await mongoose.connection
      .db!.collection('activities')
      .findOne({ _id: new mongoose.Types.ObjectId(late.eventId) });
    expect(late.occurredAt).toBe(event!.notificationContext.occurredAt.toISOString());
    expect(Date.parse(late.expiresAt) - Date.parse(late.occurredAt)).toBe(86_400_000);
  });
  it('a token rotated while a dispatch pass is running still gets the event at the new token', async () => {
    await enable(phoneA, samA, 'fictional-token-a1');
    await enable(phoneB, samB, 'fictional-token-b1');
    pause();
    expect((await create()).status).toBe(201);
    resume();
    let rotated = false;
    provider.send.mockImplementation(async (message, _signal, authorize) => {
      // Phone B rotates while phone A's send is in flight, after this pass listed both phones.
      if (!rotated) {
        rotated = true;
        const other = (message as Message).token === 'fictional-token-a1' ? phoneB : phoneA;
        const otherCookie = other === phoneA ? samA : samB;
        const next = other === phoneA ? 'fictional-token-a2' : 'fictional-token-b2';
        expect((await maintain(other, otherCookie, next)).status).toBe(200);
      }
      return (await authorize()) ? 'accepted' : 'ineligible';
    });
    await run();
    await run();
    expect(sentTokens()).toHaveLength(2);
    expect(sentTokens()[1]).toMatch(/fictional-token-(a2|b2)/);
  });
});

describe('maintenance never creates, transfers or revives consent (#844)', () => {
  it('refuses a phone that never opted in, one that opted out, and a stale revision', async () => {
    expect((await maintain(phoneA, samA, 'fictional-token-a1', 0)).status).toBe(409);
    expect(await registration(phoneA)).toBeNull();
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    expect((await maintain(phoneA, samA, 'fictional-token-a2', enabled.revision - 1)).status).toBe(
      409,
    );
    const off = await post(phoneA, samA, { revision: enabled.revision, enabled: false });
    expect(off.status).toBe(200);
    expect((await maintain(phoneA, samA, 'fictional-token-a3')).status).toBe(409);
    expect(await registration(phoneA)).toMatchObject({
      enabled: false,
      token: 'fictional-token-a1',
    });
    expect((await create()).status).toBe(201);
    expect(provider.send).not.toHaveBeenCalled();
  });
  it('another account or a new session of the same account cannot maintain the old binding', async () => {
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    const priya = await signIn('priya');
    const samAgain = await signIn('sam');
    expect((await maintain(phoneA, priya, 'fictional-token-p1', enabled.revision)).status).toBe(
      409,
    );
    expect((await maintain(phoneA, samAgain, 'fictional-token-s1', enabled.revision)).status).toBe(
      409,
    );
    expect(await registration(phoneA)).toMatchObject({
      accountId: users.sam,
      enabled: true,
      token: 'fictional-token-a1',
      binding: enabled.binding,
    });
  });
  it('maintenance cannot carry category changes, and needs a token', async () => {
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    const sneaky = await post(phoneA, samA, {
      revision: enabled.revision,
      enabled: true,
      token: 'fictional-token-a2',
      maintenance: true,
      payments: false,
    });
    expect(sneaky.status).toBe(422);
    const tokenless = await post(phoneA, samA, {
      revision: enabled.revision,
      enabled: true,
      maintenance: true,
    });
    expect(tokenless.status).toBe(422);
  });
});

describe('an invalid token is disabled without ending consent (#844)', () => {
  it('stops sends to the invalid token, keeps controls on, and the refreshed token gets later alerts', async () => {
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    // A cold start's maintenance with the unchanged token: this installation maintains itself.
    expect((await maintain(phoneA, samA, 'fictional-token-a1')).status).toBe(200);
    provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
      expect(await authorize()).toBe(true);
      return 'invalid-token';
    });
    expect((await create()).status).toBe(201);
    // While the token is invalid nothing is sent, and the controls the member chose stay on.
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual(['fictional-token-a1']);
    expect((await controls(phoneA, samA)).body.data).toMatchObject({
      enabled: true,
      expenseUpdates: true,
      revision: enabled.revision,
      binding: enabled.binding,
      expenseActivation: enabled.expenseActivation,
    });
    // Presenting the same invalid token again does not revive it.
    expect((await maintain(phoneA, samA, 'fictional-token-a1')).status).toBe(200);
    await run();
    expect(sentTokens()).toEqual(['fictional-token-a1']);
    expect((await maintain(phoneA, samA, 'fictional-token-a2')).status).toBe(200);
    await run();
    await run();
    // The second Expense, never delivered, reaches the new token once; the first is not replayed.
    expect(sentTokens()).toEqual(['fictional-token-a1', 'fictional-token-a2']);
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual([
      'fictional-token-a1',
      'fictional-token-a2',
      'fictional-token-a2',
    ]);
  });
});

/** An invalid-token answer from FCM for the next send only. */
const unregisterNextSend = () =>
  provider.send.mockImplementationOnce(async (_message, _signal, authorize) => {
    expect(await authorize()).toBe(true);
    return 'invalid-token';
  });

describe('an app that never maintains its registration keeps the 2a0b065b behaviour (#844)', () => {
  it('an invalid token switches its registration off, so its Settings shows off and the member can enable again', async () => {
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    unregisterNextSend();
    expect((await create()).status).toBe(201);
    expect((await controls(phoneA, samA)).body.data).toMatchObject({
      enabled: false,
      expenseUpdates: false,
      payments: false,
      revision: enabled.revision + 1,
    });
    expect(await registration(phoneA)).not.toHaveProperty('tokenInvalid');
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual(['fictional-token-a1']);
    // That app sends a token only on an explicit Enable.
    await enable(phoneA, samA, 'fictional-token-a2');
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual(['fictional-token-a1', 'fictional-token-a2']);
  });
  it('its GETs and POSTs answer exactly as 2a0b065b did', async () => {
    const uuid = expect.stringMatching(/^[\da-f-]{36}$/);
    const iso = expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    const off = (revision: number) => ({
      data: {
        available: true,
        enabled: false,
        expenseUpdates: false,
        payments: false,
        revision,
        activation: null,
        expenseCutoff: null,
        paymentCutoff: null,
      },
      status: 200,
    });
    const state = (data: Record<string, unknown>) => ({
      data: {
        available: true,
        activation: uuid,
        binding: uuid,
        expenseActivation: uuid,
        expenseCutoff: iso,
        // Added by #842; the 2a0b065b app's parser drops fields it doesn't know.
        paymentActivation: uuid,
        paymentCutoff: iso,
        ...data,
      },
      status: 200,
    });
    expect((await controls(phoneA, samA)).body).toEqual(off(0));
    const on = await post(phoneA, samA, {
      revision: 0,
      enabled: true,
      token: 'fictional-token-a1',
    });
    expect(on.body).toEqual(
      state({ enabled: true, expenseUpdates: true, payments: true, revision: 1 }),
    );
    const category = await post(phoneA, samA, {
      revision: 1,
      enabled: true,
      expenseUpdates: true,
      payments: false,
    });
    expect(category.body).toEqual(
      state({ enabled: true, expenseUpdates: true, payments: false, revision: 2 }),
    );
    expect((await controls(phoneA, samA)).body).toEqual(category.body);
    unregisterNextSend();
    expect((await create()).status).toBe(201);
    // As 2a0b065b: switched off, with the binding and activations it had.
    expect((await controls(phoneA, samA)).body).toEqual(
      state({ enabled: false, expenseUpdates: false, payments: false, revision: 3 }),
    );
    const again = await post(phoneA, samA, {
      revision: 3,
      enabled: true,
      token: 'fictional-token-a2',
    });
    expect(again.body).toEqual(
      state({ enabled: true, expenseUpdates: true, payments: true, revision: 4 }),
    );
    const disabled = await post(phoneA, samA, { revision: 4, enabled: false });
    expect(disabled.body).toEqual(
      state({ enabled: false, expenseUpdates: false, payments: false, revision: 5 }),
    );
    // Nothing beyond 2a0b065b's fields: the capability record never reaches a response.
    expect((await controls(phoneA, samA)).body).toEqual(disabled.body);
  });
});

describe('an installation that maintains its registration is recorded as such (#844)', () => {
  it('maintenance records it; GETs, Settings changes and a new session never erase it', async () => {
    const enabled = await enable(phoneA, samA, 'fictional-token-a1');
    expect(await registration(phoneA)).not.toHaveProperty('maintains');
    // The same token again changes no control and no revision, but records the capability.
    const same = await maintain(phoneA, samA, 'fictional-token-a1');
    expect(same.body.data.revision).toBe(enabled.revision);
    expect(await registration(phoneA)).toMatchObject({ maintains: true });
    await controls(phoneA, samA);
    const category = await post(phoneA, samA, {
      revision: enabled.revision,
      enabled: true,
      expenseUpdates: true,
      payments: false,
    });
    expect(category.status).toBe(200);
    const off = await post(phoneA, samA, { revision: category.body.data.revision, enabled: false });
    expect(off.status).toBe(200);
    expect(await registration(phoneA)).toMatchObject({ maintains: true, enabled: false });
    await signOut(samA);
    const samAgain = await signIn('sam');
    await enable(phoneA, samAgain, 'fictional-token-a2');
    expect(await registration(phoneA)).toMatchObject({ maintains: true, enabled: true });
    unregisterNextSend();
    expect((await create()).status).toBe(201);
    expect(await registration(phoneA)).toMatchObject({
      enabled: true,
      expenseUpdates: true,
      payments: true,
      tokenInvalid: true,
    });
  });
  it('a refused maintenance records nothing', async () => {
    expect((await maintain(phoneA, samA, 'fictional-token-a1', 0)).status).toBe(409);
    await enable(phoneA, samA, 'fictional-token-a1');
    expect(await registration(phoneA)).not.toHaveProperty('maintains');
  });
});

describe("two installations of one member, through the server's journeys (#844)", () => {
  it('keeps switches independent per phone', async () => {
    await enable(phoneA, samA, 'fictional-token-a1');
    const b = await enable(phoneB, samB, 'fictional-token-b1');
    const off = await post(phoneB, samB, {
      revision: b.revision,
      enabled: true,
      expenseUpdates: false,
      payments: true,
    });
    expect(off.status).toBe(200);
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual(['fictional-token-a1']);
    const on = await post(phoneB, samB, {
      revision: off.body.data.revision,
      enabled: true,
      expenseUpdates: true,
      payments: true,
    });
    expect(on.status).toBe(200);
    await run();
    // Phone B's re-enable admits only later changes.
    expect(sentTokens()).toEqual(['fictional-token-a1']);
    expect((await create()).status).toBe(201);
    expect([...sentTokens()].slice(1).sort()).toEqual(['fictional-token-a1', 'fictional-token-b1']);
  });
  it('sign-out on one phone suppresses its sends; signing in again starts off and admits only later changes', async () => {
    await enable(phoneA, samA, 'fictional-token-a1');
    await enable(phoneB, samB, 'fictional-token-b1');
    await signOut(samA);
    expect((await create()).status).toBe(201);
    expect(sentTokens()).toEqual(['fictional-token-b1']);
    // Reauthentication on phone A: a new session, whose controls start off.
    const samAgain = await signIn('sam');
    expect((await controls(phoneA, samAgain)).body.data.enabled).toBe(false);
    expect((await maintain(phoneA, samAgain, 'fictional-token-a2')).status).toBe(409);
    await run();
    expect(sentTokens()).toEqual(['fictional-token-b1']);
    const fresh = await enable(phoneA, samAgain, 'fictional-token-a2');
    await run();
    expect(sentTokens()).toEqual(['fictional-token-b1']);
    expect((await create()).status).toBe(201);
    expect([...sentTokens()].slice(1).sort()).toEqual(['fictional-token-a2', 'fictional-token-b1']);
    const last = envelopes().find((envelope) => envelope.binding === fresh.binding);
    expect(last).toMatchObject({ accountId: users.sam, activation: fresh.expenseActivation });
  });
  it('another account on the same phone gets none of the previous account’s alerts', async () => {
    await enable(phoneA, samA, 'fictional-token-a1');
    await signOut(samA);
    const priya = await signIn('priya');
    expect((await controls(phoneA, priya)).body.data.enabled).toBe(false);
    const hers = await enable(phoneA, priya, 'fictional-token-a1');
    expect((await create([users.sam])).status).toBe(201);
    expect(provider.send).not.toHaveBeenCalled();
    expect((await create([users.priya])).status).toBe(201);
    expect(envelopes()).toEqual([
      expect.objectContaining({ accountId: users.priya, binding: hers.binding }),
    ]);
  });
  it('an invalid token on one phone leaves the other phone receiving', async () => {
    await enable(phoneA, samA, 'fictional-token-a1');
    await enable(phoneB, samB, 'fictional-token-b1');
    provider.send.mockImplementation(async (message, _signal, authorize) =>
      !(await authorize())
        ? 'ineligible'
        : (message as Message).token === 'fictional-token-b1'
          ? 'invalid-token'
          : 'accepted',
    );
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(201);
    expect(sentTokens().filter((token) => token === 'fictional-token-b1')).toHaveLength(1);
    expect(sentTokens().filter((token) => token === 'fictional-token-a1')).toHaveLength(2);
  });
  it('no raw token reaches a log line or a response', async () => {
    const lines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      }),
    );
    const bodies: unknown[] = [];
    try {
      bodies.push(await enable(phoneA, samA, 'fictional-token-a1'));
      bodies.push((await maintain(phoneA, samA, 'fictional-token-a2')).body);
      bodies.push((await controls(phoneA, samA)).body);
      bodies.push((await create()).body);
      bodies.push((await run()).body);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify([lines, bodies])).not.toContain('fictional-token');
  });
});
