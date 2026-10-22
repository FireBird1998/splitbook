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
 *
 * Last, the database stops answering new connections without refusing them: one is accepted
 * and never answered. Opening it then gives up after 5 s, not the driver's 30 s.
 */

import net from 'node:net';
import { MongoClient } from 'mongodb';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONAS } from '@/lib/demo-personas';
import { MODEL_INDEXES, modelIndexes } from '@/lib/test-utils/model-indexes';

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

/**
 * A TCP proxy to the replica set. While cut, it closes every connection as it opens; while
 * silent, it holds each new one open and never answers.
 */
function proxy() {
  let mode: 'cut' | 'open' | 'silent' = 'cut';
  let attempts = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    attempts += 1;
    if (mode === 'cut') return socket.destroy();
    if (mode === 'silent') {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      return;
    }
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
      mode = 'open';
    },
    /** Answer no new connection; those open stay as they are. */
    silence: () => {
      mode = 'silent';
    },
    /** Drop every open connection, and refuse each new one. */
    cut: () => {
      mode = 'cut';
      for (const socket of sockets) socket.destroy();
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
let Invitation: typeof import('@/lib/models/Invitation').default;

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
    // A route that loads a model now: its call gives up within about 5 s too, not Mongoose's 10 s.
    ({ default: Invitation } = await import('@/lib/models/Invitation'));
    const counted = await timed(() => Invitation.countDocuments());
    expect(counted.error).toBeInstanceOf(Error);
    expect(counted.took).toBeLessThan(8_000);
    // So does a write, which is dropped, never run later: checked once the database is back.
    const written = await timed(() =>
      Invitation.updateOne(
        { token: 'fictional-buffered-write' },
        { $set: { status: 'pending' } },
        { upsert: true },
      ),
    );
    expect(written.error).toBeInstanceOf(Error);
    expect(written.took).toBeLessThan(8_000);
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
    // The write that failed while the database was unreachable never ran (ADR 0004).
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await Invitation.countDocuments({ token: 'fictional-buffered-write' })).toBe(0);
    // The model loaded while the database was unreachable gets its schema indexes (#856).
    await Invitation.init();
    expect((await modelIndexes(mongoose.connection.db!)).invitations).toEqual(
      MODEL_INDEXES.invitations,
    );
  });

  it('Mongoose and Better Auth use that one client', () => {
    expect(adapterDatabases).toHaveLength(1);
    expect(adapterDatabases[0].client).toBe(mongoose.connection.getClient());
  });

  it('when a new connection is accepted but never answered, a page’s read and a sign-in fail within about 15 s, to their caller', async () => {
    database.silence();
    // The pool's connections close once idle for 5 s, so the next call has to open a new one.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    const read = await timed(() => mongoose.connection.db!.collection('users').countDocuments());
    const signedIn = await timed(signIn);
    // A connect gives up after 5 s. From driver 7.7 (#849), a timed-out handshake is labelled
    // SystemOverloadedError and RetryableError, and retried twice with backoff (client
    // backpressure): three 5 s attempts, 15.3 s here, against 64.5 s on the driver's 30 s
    // connect default with one retry, or about 90 s with two. The sign-in after it can first wait
    // for the monitor's next 10 s heartbeat as well: 15.4 s locally, up to about 25 s.
    expect(read.error).toBeInstanceOf(Error);
    expect(read.took).toBeLessThan(18_000);
    expect(signedIn.value).not.toBe(200);
    expect(signedIn.took).toBeLessThan(32_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(unhandled).not.toHaveBeenCalled();
  }, 200_000);

  // An opened model's call goes straight to the driver during an outage, which gives up within its
  // 5 s (#856).
  it('when the connection drops after it opened, a model’s call fails within about 5 s, from the driver', async () => {
    database.cut();
    const counted = await timed(() => Invitation.countDocuments());
    expect(counted.error?.name).toMatch(/ServerSelectionError$/);
    expect(counted.took).toBeLessThan(8_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(unhandled).not.toHaveBeenCalled();
  }, 120_000);

  it('a model loaded during that outage fails within about 5 s, and gets its schema indexes once the database is back', async () => {
    expect(mongoose.modelNames()).not.toContain('Settlement');
    const { default: Settlement } = await import('@/lib/models/Settlement');
    const counted = await timed(() => Settlement.countDocuments());
    expect(counted.error).toBeInstanceOf(Error);
    expect(counted.took).toBeLessThan(8_000);
    database.restore();
    await connectDB();
    await Settlement.init();
    expect((await modelIndexes(mongoose.connection.db!)).settlements).toEqual(
      MODEL_INDEXES.settlements,
    );
    expect(unhandled).not.toHaveBeenCalled();
  }, 120_000);
});
