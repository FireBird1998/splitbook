import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';
vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
const db = integrationTestDb('notification-device-controls');
let routes: typeof import('./route');
let alex: string;
let sam: string;
const phone = '00000000-0000-4000-8000-000000000001';
const another = '00000000-0000-4000-8000-000000000002';
const key = 'private-installation-proof-000000000001';
const send = (body: unknown, cookie = alex) =>
  callRoute(routes.POST, { method: 'POST', path: '/api/notifications/device', cookie, body });
const read = (id = phone, cookie = alex, proof = key) =>
  callRoute(routes.GET, {
    method: 'GET',
    path: '/api/notifications/device?installationId=' + id,
    cookie,
    headers: { 'X-Installation-Key': proof },
  });
beforeAll(async () => {
  await connectSignedIn(db);
  routes = await import('./route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  alex = await signIn('alex');
  sam = await signIn('sam');
  vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'true');
  vi.stubEnv('MOBILE_APP_ENV', 'development');
});
afterAll(() => disconnectSignedIn(db));
describe('per-device notification controls through authenticated HTTP and real MongoDB', () => {
  it('starts off, confirms opt-in and keeps two phones independent without financial writes', async () => {
    expect((await read()).body.data.enabled).toBe(false);
    const first = await send({
      installationId: phone,
      installationKey: key,
      revision: 0,
      enabled: true,
      token: 'private-fcm-token',
    });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      enabled: true,
      expenseUpdates: true,
      payments: true,
      revision: 1,
    });
    expect(first.body.data.expenseCutoff).toBeTruthy();
    expect(JSON.stringify(first.body)).not.toContain('private-fcm-token');
    expect((await read(another)).body.data.enabled).toBe(false);
    for (const name of ['expenses', 'settlements', 'activities'])
      expect(await mongoose.connection.db!.collection(name).countDocuments()).toBe(0);
  });
  it('rejects stale preferences and moves only the re-enabled category cutoff', async () => {
    const first = (
      await send({
        installationId: phone,
        installationKey: key,
        revision: 0,
        enabled: true,
        token: 'token-a',
      })
    ).body.data;
    expect(
      (await send({ installationId: phone, installationKey: key, revision: 0, enabled: false }))
        .status,
    ).toBe(409);
    const off = (
      await send({
        installationId: phone,
        installationKey: key,
        revision: 1,
        enabled: true,
        expenseUpdates: false,
        payments: true,
      })
    ).body.data;
    const on = (
      await send({
        installationId: phone,
        installationKey: key,
        revision: off.revision,
        enabled: true,
        expenseUpdates: true,
        payments: true,
      })
    ).body.data;
    expect(on.activation).not.toBe(first.activation);
    expect(on.paymentCutoff).toBe(first.paymentCutoff);
    expect(Date.parse(on.expenseCutoff)).toBeGreaterThanOrEqual(Date.parse(first.expenseCutoff));
  });
  it('denies installation takeover and another account cannot read consent', async () => {
    await send({
      installationId: phone,
      installationKey: key,
      revision: 0,
      enabled: true,
      token: 'token-a',
    });
    expect((await read(phone, sam)).body.data.enabled).toBe(false);
    expect(
      (
        await send(
          {
            installationId: phone,
            installationKey: 'wrong-private-proof-000000000000000000',
            revision: 0,
            enabled: true,
            token: 'token-b',
          },
          sam,
        )
      ).status,
    ).toBe(403);
    expect((await read(phone, alex, 'wrong-private-proof-000000000000000000')).status).toBe(403);
  });
  it('rejects persisted session revocation even with a cached signed cookie', async () => {
    await send({
      installationId: phone,
      installationKey: key,
      revision: 0,
      enabled: true,
      token: 'token-a',
    });
    await mongoose.connection.db!.collection('sessions').deleteMany({});
    expect(
      (await send({ installationId: phone, installationKey: key, revision: 1, enabled: false }))
        .status,
    ).toBe(401);
  });
  it('gives one token one active binding and never transfers account consent', async () => {
    await send({
      installationId: phone,
      installationKey: key,
      revision: 0,
      enabled: true,
      token: 'same-token',
    });
    const bound = await send(
      {
        installationId: another,
        installationKey: key,
        revision: 0,
        enabled: true,
        token: 'same-token',
      },
      sam,
    );
    expect(bound.status).toBe(200);
    expect((await read()).body.data.enabled).toBe(false);
    expect((await read(another, alex)).body.data.enabled).toBe(false);
  });
  it('keeps account transitions off and refuses the previous binding revision', async () => {
    await send({
      installationId: phone,
      installationKey: key,
      revision: 0,
      enabled: true,
      token: 'token-a',
    });
    const before = (await read(phone, sam)).body.data;
    expect(before).toMatchObject({
      enabled: false,
      expenseUpdates: false,
      payments: false,
      revision: 1,
    });
    const switched = await send(
      {
        installationId: phone,
        installationKey: key,
        revision: before.revision,
        enabled: true,
        token: 'token-a',
      },
      sam,
    );
    expect(switched.status).toBe(200);
    expect(
      (await send({ installationId: phone, installationKey: key, revision: 1, enabled: false }))
        .status,
    ).toBe(409);
    expect((await read(phone, sam)).body.data.enabled).toBe(true);
  });
  it('serializes concurrent preferences so only one stale revision is accepted', async () => {
    await send({
      installationId: phone,
      installationKey: key,
      revision: 0,
      enabled: true,
      token: 'token-a',
    });
    const changes = await Promise.all([
      send({
        installationId: phone,
        installationKey: key,
        revision: 1,
        enabled: true,
        expenseUpdates: false,
      }),
      send({
        installationId: phone,
        installationKey: key,
        revision: 1,
        enabled: true,
        payments: false,
      }),
    ]);
    expect(changes.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('sets new cutoffs on re-enable and rejects caller-selected identity or environment', async () => {
    const first = (
      await send({
        installationId: phone,
        installationKey: key,
        revision: 0,
        enabled: true,
        token: 'token-a',
      })
    ).body.data;
    await send({ installationId: phone, installationKey: key, revision: 1, enabled: false });
    const again = (
      await send({
        installationId: phone,
        installationKey: key,
        revision: 2,
        enabled: true,
        token: 'token-a',
      })
    ).body.data;
    expect(again.activation).not.toBe(first.activation);
    expect(again).toMatchObject({ expenseUpdates: true, payments: true });
    expect(Date.parse(again.expenseCutoff)).toBeGreaterThanOrEqual(Date.parse(first.expenseCutoff));
    expect(
      (
        await send({
          installationId: phone,
          installationKey: key,
          revision: 3,
          enabled: false,
          accountId: 'attacker',
          environment: 'production',
        })
      ).status,
    ).toBe(422);
  });
  it('returns private no-store on success and denial and defaults feature off', async () => {
    vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', '');
    const checked = async (req: Request) => {
      const response = await routes.GET(req);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      return response;
    };
    const result = await callRoute(checked, {
      method: 'GET',
      path: '/api/notifications/device?installationId=' + phone,
      cookie: alex,
      headers: { 'X-Installation-Key': key },
    });
    expect(result.body.data).toMatchObject({ available: false, enabled: false });
    expect(
      (
        await send({
          installationId: phone,
          installationKey: key,
          revision: 0,
          enabled: true,
          token: 'token-a',
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await callRoute(checked, {
          method: 'GET',
          path: '/api/notifications/device?installationId=' + phone,
          cookie: '',
          headers: { 'X-Installation-Key': key },
        })
      ).status,
    ).toBe(401);
  });

  it('rejects a simultaneous first-registration revision rather than accepting two bindings', async () => {
    const results = await Promise.all([
      send({
        installationId: phone,
        installationKey: key,
        revision: 0,
        enabled: true,
        token: 'initial-token-a',
      }),
      send(
        {
          installationId: phone,
          installationKey: key,
          revision: 0,
          enabled: true,
          token: 'initial-token-b',
        },
        sam,
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('reports paused availability separately from confirmed consent and still permits turning off', async () => {
    await send({
      installationId: phone,
      installationKey: key,
      revision: 0,
      enabled: true,
      token: 'pause-token',
    });
    vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', '');
    expect((await read()).body.data).toMatchObject({
      available: false,
      enabled: true,
      expenseUpdates: true,
      payments: true,
    });
    const disabled = await send({
      installationId: phone,
      installationKey: key,
      revision: 1,
      enabled: false,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data).toMatchObject({
      available: false,
      enabled: false,
      expenseUpdates: false,
      payments: false,
    });
  });
});
