/**
 * #826, #858: what a member's request meets when the database drops, through the real routes with
 * a real session, against a real replica set reached through a proxy this file interrupts
 * (`database-proxy.ts`). Its database is `splitbook-test-database-unavailable`.
 *
 * The owner's decision of 2026-11-05: the request answers "Couldn't reach Splitbook. Try again."
 * within about 5 s, never after a 30 s hang or as "Internal server error". A save is never
 * recorded twice (ADR 0004): its retry, with the same Idempotency-Key, records it once.
 */

import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDB } from '@/lib/db';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { databaseProxy, timed } from '@/lib/test-utils/database-proxy';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('database-unavailable');
const target = new URL(process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017');
const database = databaseProxy(target);
/** The replica set itself, past the proxy: for the failpoint and the checks. */
const direct = new MongoClient(`mongodb://${target.host}/${db.dbName}?directConnection=true`, {
  serverSelectionTimeoutMS: 5_000,
});
const unhandled = vi.fn();
const { alex } = DEMO_PERSONA_IDS;

const unavailable = {
  status: 503,
  body: {
    error: 'Couldn’t reach Splitbook. Try again.',
    code: 'DATABASE_UNAVAILABLE',
    status: 503,
  },
};

let routes: { expenses: typeof import('./groups/[id]/expenses/route') };
let cookie: string;
let groupId: string;

/** The pool's idle connections close after 5 s, so the next request has to open one. */
const idlePool = () => new Promise((resolve) => setTimeout(resolve, 6_000));

const listExpenses = () =>
  callRoute(routes.expenses.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/expenses`,
    params: { id: groupId },
    cookie,
  });

const addExpense = (key: string, description: string) =>
  callRoute(routes.expenses.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/expenses`,
    params: { id: groupId },
    cookie,
    headers: { 'Idempotency-Key': key },
    body: {
      description,
      amount: 300,
      currency: 'INR',
      category: 'food',
      date: '2026-10-10',
      tag: 'Food',
      paidBy: [{ user: alex, amount: 300 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }],
    },
  });

/** How many Expenses the replica set holds with `description`, read past the proxy. */
const stored = (description: string) =>
  direct.db().collection('expenses').countDocuments({ description });

beforeAll(async () => {
  process.on('unhandledRejection', unhandled);
  const port = await database.listen();
  await direct.connect();
  await direct.db().dropDatabase();
  // The app's client reaches the file's database through the proxy, named for the failpoint.
  vi.stubEnv(
    'MONGODB_URI',
    `mongodb://127.0.0.1:${port}/${db.dbName}?directConnection=true&appName=${db.dbName}`,
  );
  await connectSignedIn({ ...db, connect: async () => void (await connectDB()) });
  await insertDemoPersonas();
  routes = { expenses: await import('./groups/[id]/expenses/route') };
  cookie = await signIn('alex');
  const { groupService } = await import('@/lib/services/group.service');
  const group = await groupService.create(
    {
      name: 'Hampi Weekend',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
      startDate: new Date('2026-10-09'),
      endDate: new Date('2026-10-11'),
    },
    alex,
  );
  groupId = String(group._id);
  expect(await listExpenses()).toMatchObject({ status: 200 });
});
afterAll(async () => {
  process.off('unhandledRejection', unhandled);
  database.restore();
  await direct
    .db('admin')
    .command({ configureFailPoint: 'failCommand', mode: 'off' })
    .catch(() => {});
  await disconnectSignedIn(db);
  await direct.close();
  await database.close();
});

describe('a database that went away (#826, #858)', () => {
  it('a read answers "Couldn’t reach Splitbook. Try again." within about 5 s, never 30 s or "Internal server error"', async () => {
    database.cut();
    try {
      const read = await timed(listExpenses);
      expect(read.value).toEqual(unavailable);
      expect(read.took).toBeGreaterThanOrEqual(4_500);
      expect(read.took).toBeLessThan(6_500);
    } finally {
      database.restore();
    }
  }, 30_000);

  it('a save answers the same within about 5 s and records nothing; its retry once it is back records it once', async () => {
    const key = 'expense-outage-0001';
    database.cut();
    try {
      const save = await timed(() => addExpense(key, 'Outage dinner'));
      expect(save.value).toEqual(unavailable);
      expect(save.took).toBeLessThan(6_500);
    } finally {
      database.restore();
    }
    // Nothing was applied, then or later (ADR 0004).
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await stored('Outage dinner')).toBe(0);

    const retried = await addExpense(key, 'Outage dinner');
    expect(retried.status).toBe(201);
    // A lost reply's retry with the same key is answered with the same Expense.
    const again = await addExpense(key, 'Outage dinner');
    expect(again).toMatchObject({ status: 201, body: { data: { _id: retried.body.data._id } } });
    expect(await stored('Outage dinner')).toBe(1);
  }, 60_000);

  it('a save whose connection drops mid-save is never "Internal server error", and is recorded once by its retry', async () => {
    const key = 'expense-midsave-0001';
    // Every insert this file's client sends loses its connection, inside the save's transaction.
    await direct.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: 'alwaysOn',
      data: { failCommands: ['insert'], closeConnection: true, appName: db.dbName },
    });
    try {
      const save = await timed(() => addExpense(key, 'Dropped dinner'));
      expect(save.value).toEqual(unavailable);
      expect(save.took).toBeLessThan(6_500);
    } finally {
      await direct.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await stored('Dropped dinner')).toBe(0);
    expect(await addExpense(key, 'Dropped dinner')).toMatchObject({ status: 201 });
    expect(await addExpense(key, 'Dropped dinner')).toMatchObject({ status: 201 });
    expect(await stored('Dropped dinner')).toBe(1);
  }, 60_000);

  it('a page’s session read fails within about 5 s with the error its boundary knows (`app/error.tsx`)', async () => {
    const { getAuthUser } = await import('@/lib/utils/api-response');
    /** A page's layout's first read: the session, with only its token, so the database answers it. */
    const page = () =>
      callRoute(
        async () => {
          const started = Date.now();
          try {
            return Response.json({ user: (await getAuthUser())?.id, took: Date.now() - started });
          } catch (error) {
            const { name, digest } = error as Error & { digest?: string };
            return Response.json({ thrown: { name, digest }, took: Date.now() - started });
          }
        },
        {
          method: 'GET',
          path: '/dashboard',
          cookie: cookie
            .split('; ')
            .filter((part) => !part.includes('session_data'))
            .join('; '),
        },
      );
    expect(await page()).toMatchObject({ body: { user: alex } });
    await idlePool();
    database.cut();
    try {
      const failed = await page();
      expect(failed.body.thrown).toEqual({
        name: 'DatabaseUnavailableError',
        digest: 'DATABASE_UNAVAILABLE',
      });
      expect(failed.body.took).toBeLessThan(6_500);
    } finally {
      database.restore();
    }
    expect(await page()).toMatchObject({ body: { user: alex } });
  }, 60_000);

  it('a sign-in answers the same within about 5 s, never Better Auth’s bare 500', async () => {
    const { POST } = await import('./auth/[...all]/route');
    await idlePool();
    database.cut();
    try {
      const signedIn = await timed(() =>
        POST(
          new Request('http://localhost:3000/api/auth/demo-persona/sign-in', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
            body: JSON.stringify({ personaId: 'alex' }),
          }),
        ),
      );
      expect(signedIn.value?.status).toBe(503);
      expect(await signedIn.value?.json()).toEqual(unavailable.body);
      expect(signedIn.took).toBeLessThan(6_500);
    } finally {
      database.restore();
    }
  }, 60_000);

  it('left nothing unhandled', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(unhandled).not.toHaveBeenCalled();
  });
});
