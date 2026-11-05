import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient, MongoServerError, ObjectId, UUID } from 'mongodb';
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * #826: one MongoDB client per server instance, shared by Mongoose and Better Auth, and set to
 * fail fast. No database here: a client connects only when it is first used.
 */

const attachDatabasePool = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', () => ({ attachDatabasePool }));

/** The module as a new server instance loads it, with no client made yet. */
async function freshServer() {
  Reflect.deleteProperty(globalThis, '_splitbookMongo');
  vi.resetModules();
  return import('./mongodb-client');
}

const LOCAL = 'mongodb://127.0.0.1:27999/splitbook-unit?directConnection=true';
const ATLAS = 'mongodb+srv://cluster0.example.mongodb.net/splitbook?retryWrites=true';

beforeEach(() => attachDatabasePool.mockClear());
afterEach(() => vi.unstubAllEnvs());

describe('the MongoDB client (#826)', () => {
  it('is one per server instance, and fails fast', async () => {
    vi.stubEnv('MONGODB_URI', LOCAL);
    const { getAuthDb } = await freshServer();
    const client = getAuthDb().client;
    expect(getAuthDb().client).toBe(client);
    expect(client.options).toMatchObject({
      serverSelectionTimeoutMS: 5_000,
      maxPoolSize: 10,
      maxIdleTimeMS: 5_000,
      connectTimeoutMS: 5_000,
      directConnection: true,
    });
    expect(getAuthDb().databaseName).toBe('splitbook-unit');
  });

  // A page's parallel calls open their connections together, not two at a time (#849).
  it('may open all of its pool’s connections at once', async () => {
    vi.stubEnv('MONGODB_URI', LOCAL);
    const { getAuthDb } = await freshServer();
    expect(getAuthDb().client.options.maxConnecting).toBe(10);
    expect(getAuthDb().client.options.maxConnecting).toBe(getAuthDb().client.options.maxPoolSize);
  });

  it('survives a reload of the module, as dev’s HMR reloads it, and joins Vercel’s pool once', async () => {
    vi.stubEnv('MONGODB_URI', LOCAL);
    const first = (await freshServer()).getAuthDb().client;
    vi.resetModules();
    const again = (await import('./mongodb-client')).getAuthDb().client;
    expect(again).toBe(first);
    expect(attachDatabasePool.mock.calls).toEqual([[first]]);
  });

  it('never connects directly to Atlas, and takes the database from the URI', async () => {
    vi.stubEnv('MONGODB_URI', ATLAS);
    const { getAuthDb } = await freshServer();
    expect(getAuthDb().client.options).toMatchObject({
      directConnection: false,
      serverSelectionTimeoutMS: 5_000,
      maxPoolSize: 10,
      maxIdleTimeMS: 5_000,
      connectTimeoutMS: 5_000,
    });
    expect(getAuthDb().databaseName).toBe('splitbook');
  });

  it('builds without MONGODB_URI, as `next build` does, and a connection then says it is missing', async () => {
    vi.stubEnv('MONGODB_URI', '');
    const { getAuthDb } = await freshServer();
    expect(getAuthDb().databaseName).toBe('splitbook-unconfigured');
    const { connectDB } = await import('./db');
    await expect(connectDB()).rejects.toThrow('Please define the MONGODB_URI environment variable');
  });
});

// Atlas's standard connection string names every host of its replica set (#850).
const ATLAS_STANDARD =
  'mongodb://db-00.example.net:27017,db-01.example.net:27017,db-02.example.net:27017/splitbook?replicaSet=atlas-x1&tls=true';

describe('connecting directly, only to a single host (#850)', () => {
  it.each([
    ['a single-host URI connects directly', 'mongodb://127.0.0.1:27017/splitbook', true],
    ['so does a single IPv6 host', 'mongodb://[::1]:27017/splitbook', true],
    ['a URI naming several hosts connects as their replica set', ATLAS_STANDARD, false],
    [
      'a URI that says how to connect is taken at its word',
      'mongodb://127.0.0.1:27017/splitbook?directConnection=false',
      false,
    ],
    ['Atlas’s srv URI never connects directly', ATLAS, false],
  ])('%s', async (_, uri, direct) => {
    vi.stubEnv('MONGODB_URI', uri);
    const { getAuthDb } = await freshServer();
    expect(getAuthDb().client.options.directConnection).toBe(direct);
    expect(getAuthDb().databaseName).toBe('splitbook');
  });

  it('the build’s placeholder, with no MONGODB_URI, still connects directly', async () => {
    vi.stubEnv('MONGODB_URI', '');
    const { getAuthDb } = await freshServer();
    expect(getAuthDb().client.options.directConnection).toBe(true);
  });
});

// One mongodb driver serves Mongoose, Better Auth's adapter and the app (#849), so its classes
// are one set: a client, a driver error and an id are each the same class wherever they come from.
describe('one driver', () => {
  it('the workspace resolves one mongodb, one bson and one URI parser', () => {
    const lockfile = readFileSync(path.resolve(__dirname, '../../../../pnpm-lock.yaml'), 'utf8');
    const versions = (name: string) => [
      ...new Set(
        [...lockfile.matchAll(new RegExp(`^  ${name}@(\\d+\\.\\d+\\.\\d+):`, 'gm'))].map(
          ([, version]) => version,
        ),
      ),
    ];
    expect(versions('mongodb')).toHaveLength(1);
    expect(versions('mongodb-connection-string-url')).toHaveLength(1);
    expect(versions('bson')).toEqual([expect.stringMatching(/^7\.3\./)]);
  });

  it('Mongoose’s client is the app’s', () => {
    expect(mongoose.mongo.MongoClient).toBe(MongoClient);
  });

  it('a driver error is one class, so an `instanceof` check holds for each', () => {
    expect(mongoose.mongo.MongoServerError).toBe(MongoServerError);
  });

  it('an id is one class, so Better Auth’s and the migrations’ `instanceof` checks hold', () => {
    expect(mongoose.mongo.ObjectId).toBe(ObjectId);
    expect(mongoose.Types.ObjectId).toBe(ObjectId);
    expect(mongoose.mongo.UUID).toBe(UUID);
  });
});

/** A driver error as a refused connection leaves it (#862): labelled as the driver labels it. */
function refusedConnection() {
  const error = new mongoose.mongo.MongoNetworkError('connect ECONNREFUSED 127.0.0.1:27017', {
    cause: new Error('connect ECONNREFUSED 127.0.0.1:27017'),
  });
  error.addErrorLabel('SystemOverloadedError');
  error.addErrorLabel('RetryableError');
  return error;
}

// The owner's decision of 2026-11-05 (#826, #858, #862): one retry, then "Couldn't reach
// Splitbook. Try again." within about 5 s.
describe('a database that can’t be reached', () => {
  it('is tried once more after 1 s, and answered within 5 s', async () => {
    const { DATABASE_RETRY } = await freshServer();
    expect(DATABASE_RETRY).toEqual({ afterMs: 1_000, answerWithinMs: 5_000 });
  });

  it('is a DatabaseUnavailableError in the owner’s words, with a code and a digest a page keeps', async () => {
    const { DatabaseUnavailableError } = await freshServer();
    const cause = refusedConnection();
    const error = new DatabaseUnavailableError(cause);
    expect(error).toMatchObject({
      name: 'DatabaseUnavailableError',
      message: 'Couldn’t reach Splitbook. Try again.',
      code: 'DATABASE_UNAVAILABLE',
      digest: 'DATABASE_UNAVAILABLE',
      cause,
    });
  });

  it.each([
    [
      'a server selection that timed out',
      () =>
        new mongoose.mongo.MongoServerSelectionError('Server selection timed out after 5000 ms', {
          servers: new Map(),
        } as never),
    ],
    ['a refused connection', refusedConnection],
    [
      'a connection that timed out',
      () => new mongoose.mongo.MongoNetworkTimeoutError('connection timed out'),
    ],
    [
      'a ping whose time ran out, waiting for a server',
      () =>
        new mongoose.mongo.MongoOperationTimeoutError('Timed out during server selection', {
          cause: new mongoose.mongo.MongoServerSelectionError('read ECONNRESET', {
            servers: new Map(),
          } as never),
        }),
    ],
    [
      'a server shedding load',
      () => {
        const error = new mongoose.mongo.MongoServerError({ message: 'overloaded', code: 462 });
        error.addErrorLabel('SystemOverloadedError');
        return error;
      },
    ],
    [
      'a Mongoose call that waited out a connection',
      () => new mongoose.Error('Operation `users.findOne()` buffering timed out after 5000ms'),
    ],
    ['a closed client', () => new mongoose.mongo.MongoTopologyClosedError()],
    [
      'an error caused by one',
      () => new Error('Session read failed', { cause: refusedConnection() }),
    ],
  ])('counts %s as unreachable', async (_, make) => {
    const { isDatabaseUnreachable } = await freshServer();
    expect(isDatabaseUnreachable(make())).toBe(true);
  });

  it.each([
    [
      'a duplicate key',
      () => new mongoose.mongo.MongoServerError({ message: 'E11000', code: 11000 }),
    ],
    ['a domain refusal', () => new Error('FORBIDDEN')],
    [
      'a transaction that ran out of time with no network failure',
      () => new mongoose.mongo.MongoOperationTimeoutError('Timed out during withTransaction'),
    ],
    ['a failed fetch of something else', () => new TypeError('fetch failed')],
    ['a value that isn’t an error', () => 'ECONNREFUSED'],
  ])('never counts %s as unreachable', async (_, make) => {
    const { isDatabaseUnreachable } = await freshServer();
    expect(isDatabaseUnreachable(make())).toBe(false);
  });
});

describe('the one retry (withDatabaseRetry)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Runs `retried` to its end on the fake clock: what it settled to, when, and each try's start. */
  async function run(attempts: Array<(deadline: number) => Promise<string>>) {
    const { withDatabaseRetry, DatabaseUnavailableError } = await freshServer();
    const started = Date.now();
    const tries: { at: number; deadline: number }[] = [];
    let result: { value?: string; error?: unknown; at?: number } = {};
    const pending = withDatabaseRetry((deadline) => {
      tries.push({ at: Date.now() - started, deadline: deadline - started });
      return attempts[tries.length - 1](deadline);
    }).then(
      (value) => (result = { value, at: Date.now() - started }),
      (error: unknown) => (result = { error, at: Date.now() - started }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    return { ...result, tries, unavailable: result.error instanceof DatabaseUnavailableError };
  }

  const failsAfter = (ms: number, error: () => unknown) => () =>
    new Promise<string>((_, reject) => setTimeout(() => reject(error()), ms));
  const answers =
    (ms = 10) =>
    () =>
      new Promise<string>((resolve) => setTimeout(() => resolve('answered'), ms));

  it('runs once when the database answers', async () => {
    const outcome = await run([answers(20)]);
    expect(outcome.unavailable).toBe(false);
    expect(outcome).toMatchObject({ value: 'answered', at: 20 });
    expect(outcome.tries).toEqual([{ at: 0, deadline: 5_000 }]);
  });

  it('rides out a blip: a refusal is tried once more 1 s later, by the same deadline', async () => {
    const outcome = await run([failsAfter(200, refusedConnection), answers(10)]);
    expect(outcome).toMatchObject({ value: 'answered', at: 1_210 });
    expect(outcome.tries).toEqual([
      { at: 0, deadline: 5_000 },
      { at: 1_200, deadline: 5_000 },
    ]);
  });

  it('a second failure is a DatabaseUnavailableError, and nothing runs a third time', async () => {
    const second = refusedConnection();
    const outcome = await run([failsAfter(300, refusedConnection), failsAfter(300, () => second)]);
    expect(outcome.unavailable).toBe(true);
    expect((outcome.error as Error).cause).toBe(second);
    expect(outcome.at).toBe(1_600);
    expect(outcome.tries).toHaveLength(2);
  });

  it('no retry when it couldn’t finish within 5 s: a server that wasn’t found in 5 s is answered then', async () => {
    const outcome = await run([
      failsAfter(
        5_000,
        () =>
          new mongoose.mongo.MongoServerSelectionError('Server selection timed out after 5000 ms', {
            servers: new Map(),
          } as never),
      ),
      answers(),
    ]);
    expect(outcome.unavailable).toBe(true);
    expect(outcome.at).toBe(5_000);
    expect(outcome.tries).toHaveLength(1);
  });

  it('any other error is the caller’s, as it is, with no retry', async () => {
    const refusal = new Error('FORBIDDEN');
    const outcome = await run([failsAfter(50, () => refusal), answers()]);
    expect(outcome.error).toBe(refusal);
    expect(outcome.tries).toHaveLength(1);
  });

  it('a ping whose own time ran out counts as no answer', async () => {
    const outcome = await run([
      failsAfter(
        400,
        () => new mongoose.mongo.MongoOperationTimeoutError('Timed out during connection checkout'),
      ),
      answers(),
    ]);
    expect(outcome).toMatchObject({ value: 'answered', at: 1_410 });
  });
});
