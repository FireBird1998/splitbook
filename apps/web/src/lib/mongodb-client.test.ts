import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ObjectId, UUID } from 'mongodb';
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

// Better Auth's adapter types come from the app's mongodb 7.1, while the shared client is
// Mongoose's own 7.0 driver. Ids cross that boundary as one class; driver errors don't.
describe('across the two drivers', () => {
  it('an id is one class, so Better Auth’s and the migrations’ `instanceof` checks still hold', () => {
    expect(mongoose.mongo.ObjectId).toBe(ObjectId);
    expect(mongoose.Types.ObjectId).toBe(ObjectId);
    expect(mongoose.mongo.UUID).toBe(UUID);
  });

  it('no source checks a driver error by its class, only by its code or name', () => {
    const source = path.resolve(__dirname, '..');
    const files = readdirSync(source, { recursive: true, encoding: 'utf8' }).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    const byClass = files.filter((file) =>
      /instanceof\s+(?:mongo(?:ose\.mongo)?\.)?Mongo\w*Error\b/.test(
        readFileSync(path.join(source, file), 'utf8'),
      ),
    );
    expect(byClass).toEqual([]);
  });
});
