/**
 * #826: the app's one MongoDB client, against a real replica set reached through a proxy this
 * file can cut, as a server instance meets a database it can't reach (staging's 30 s hangs,
 * ending in an unhandledRejection). Its database is `splitbook-test-mongodb-connection`.
 *
 * The client's first connect fails here, while the proxy is cut. A driver that failed its first
 * connect keeps the closed topology, and every later operation that connects by itself answers
 * "Topology is closed", even once the database is back: Better Auth's client did, so one failed
 * connect left sign-in broken for the life of the instance. Now every connection, a sign-in's
 * included, goes through one explicit connect that is tried again after a failure.
 */

import net from 'node:net';
import { MongoClient } from 'mongodb';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONAS } from '@/lib/demo-personas';

/** Every database Better Auth's adapter is given, as `@/lib/auth` loads. */
const adapterDatabases = vi.hoisted(() => [] as Array<{ client: unknown }>);
vi.mock('better-auth/adapters/mongodb', async (original) => {
  const actual = await original<typeof import('better-auth/adapters/mongodb')>();
  return {
    ...actual,
    mongodbAdapter: (...args: Parameters<typeof actual.mongodbAdapter>) => {
      adapterDatabases.push(args[0]);
      return actual.mongodbAdapter(...args);
    },
  };
});
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const DATABASE = 'splitbook-test-mongodb-connection';
const APP_URL = 'http://localhost:3000';
const target = new URL(process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017');

/** A TCP proxy to the replica set: while cut, it closes every connection as it opens. */
function proxy() {
  let cut = true;
  let attempts = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    attempts += 1;
    if (cut) return socket.destroy();
    const upstream = net.connect(Number(target.port), target.hostname);
    for (const end of [socket, upstream]) {
      sockets.add(end);
      end.on('close', () => sockets.delete(end));
      end.on('error', () => {});
    }
    socket.pipe(upstream).pipe(socket);
  });
  return {
    server,
    /** How many connections have been opened to it. */
    attempts: () => attempts,
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)),
      ),
    restore: () => {
      cut = false;
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

const database = proxy();
/** The replica set itself, past the proxy: for the personas and the cleanup. */
const direct = new MongoClient(`mongodb://${target.host}/${DATABASE}?directConnection=true`, {
  serverSelectionTimeoutMS: 5_000,
});
const unhandled = vi.fn();
let auth: typeof import('@/lib/auth').auth;
let connectDB: typeof import('@/lib/db').connectDB;

/** A demo persona sign-in through Better Auth's handler: its status, or what it threw. */
async function signIn(): Promise<number | string> {
  try {
    const response = await auth.handler(
      new Request(`${APP_URL}/api/auth/demo-persona/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP_URL },
        body: JSON.stringify({ personaId: 'alex' }),
      }),
    );
    return response.status;
  } catch (error) {
    return (error as Error).name;
  }
}

/** How long `run` takes, in milliseconds, with what it settled to. */
async function timed<T>(
  run: () => Promise<T>,
): Promise<{ value?: T; error?: Error; took: number }> {
  const started = Date.now();
  const settled = await run().then(
    (value) => ({ value }),
    (error: Error) => ({ error }),
  );
  return { ...settled, took: Date.now() - started };
}

beforeAll(async () => {
  process.on('unhandledRejection', unhandled);
  const port = await database.listen();
  vi.stubEnv('MONGODB_URI', `mongodb://127.0.0.1:${port}/${DATABASE}?directConnection=true`);
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-the-connection-tests');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  ({ auth } = await import('@/lib/auth'));
  ({ connectDB } = await import('@/lib/db'));
  await direct.connect();
  await direct.db().dropDatabase();
});
afterAll(async () => {
  process.off('unhandledRejection', unhandled);
  await mongoose.disconnect();
  await direct.db().dropDatabase();
  await direct.close();
  await database.close();
  vi.unstubAllEnvs();
});

describe('the app’s one MongoDB client (#826)', () => {
  // A connection nobody waits for would fail unseen, as an unhandledRejection.
  it('loading the app connects to nothing until a request asks', async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(database.attempts()).toBe(0);
  });

  it('while the database can’t be reached, a page’s read and a sign-in each fail within about 5 s, to their caller', async () => {
    // Both fail first, so the client's first connect has failed whatever is asserted next.
    const read = await timed(() => connectDB());
    const signedIn = await timed(signIn);
    expect(read.error?.name).toMatch(/ServerSelectionError$/);
    expect(read.took).toBeLessThan(8_000);
    expect(signedIn.value).not.toBe(200);
    expect(signedIn.took).toBeLessThan(8_000);
    // Anything left unhandled surfaces within a tick or two of the failure.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(unhandled).not.toHaveBeenCalled();
  }, 120_000);

  it('once it is back, sign-in works again on that same client, and so do reads', async () => {
    database.restore();
    await direct
      .db()
      .collection('users')
      .insertMany(
        DEMO_PERSONAS.map((persona) => ({
          _id: new mongoose.Types.ObjectId(persona.id),
          name: persona.name,
          email: persona.email,
          preferredCurrency: 'INR',
        })),
      );
    // Sign-in first: nothing else has connected the client since its first connect failed.
    expect(await signIn()).toBe(200);
    await connectDB();
    expect(await mongoose.connection.db!.collection('users').countDocuments()).toBe(3);
  });

  it('Mongoose and Better Auth use that one client', () => {
    expect(adapterDatabases).toHaveLength(1);
    expect(adapterDatabases[0].client).toBe(mongoose.connection.getClient());
  });
});
