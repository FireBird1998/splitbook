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

// The owner's decision of 2026-11-05 (#826): "Couldn't reach Splitbook. Try again." within about
// 5 s.
describe('a database that can’t be reached', () => {
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
