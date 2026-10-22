// The app's one MongoDB client per server instance, shared by Mongoose (`lib/db.ts`) and Better
// Auth's adapter (#826). Building it doesn't connect, so it is safe at import time (including
// `next build`, where MONGODB_URI may be absent). Connecting goes through `connectMongo()`.

import 'server-only';
import { attachDatabasePool } from '@vercel/functions';
import type { mongodbAdapter } from 'better-auth/adapters/mongodb';
import type { Db } from 'mongodb';
import mongoose from 'mongoose';
import { directConnectionFor } from '@/lib/mongodb-uri';

/**
 * How the client connects, as the owner confirmed in #826's grilling (2026-10-22): a page waits
 * at most 5 s for a server, an instance keeps at most 10 connections, and an idle one closes
 * after 5 s. Opening a connection also gives up after 5 s, the connect half of the owner's 5 s:
 * a database that accepts a connection and never answers it would otherwise hold a page for the
 * driver's 30 s. So a page fails within about 5 s when MongoDB refuses, and about 15 s when a new
 * connection hangs (driver 7.7 retries a timed-out handshake twice, #849). Operations themselves
 * have no time limit (no socketTimeoutMS or timeoutMS).
 *
 * All of the pool's connections may be opened at once (`maxConnecting`, the owner's choice in
 * #849). A retried handshake no longer clears the pool, so with the driver's default of 2 a
 * page's parallel reads on a hung connection waited behind each other and settled at 40 s; opened
 * together, they fail together, as one read does.
 */
const MAX_POOL_SIZE = 10;
export const MONGO_CONNECTION_OPTIONS = {
  serverSelectionTimeoutMS: 5_000,
  maxPoolSize: MAX_POOL_SIZE,
  maxConnecting: MAX_POOL_SIZE,
  maxIdleTimeMS: 5_000,
  connectTimeoutMS: 5_000,
} as const;

// A syntactically valid placeholder so an unconfigured build still constructs
// the auth instance; any database call would fail loudly at request time.
const UNCONFIGURED_URI = 'mongodb://127.0.0.1:27017/splitbook-unconfigured';

type MongoClient = mongoose.mongo.MongoClient;

interface SharedMongo {
  uri: string | undefined;
  client: MongoClient;
  connecting: Promise<MongoClient> | null;
}

// One per instance, kept across dev's HMR reloads so dev does not leak connections.
const globalWithMongo = global as typeof globalThis & { _splitbookMongo?: SharedMongo };

function createClient(uri: string): MongoClient {
  // Mongoose's driver, which `setClient()` requires, is the app's own mongodb (#849). The
  // database is the URI's path.
  const client = new mongoose.mongo.MongoClient(uri, {
    ...MONGO_CONNECTION_OPTIONS,
    ...directConnectionFor(uri),
    // What Mongoose sets on a client it makes itself.
    driverInfo: { name: 'Mongoose', version: mongoose.version },
  });
  client.setMaxListeners(0);
  // On Vercel, keeps an instance alive until its idle connections have closed.
  attachDatabasePool(client);
  return client;
}

function shared(): SharedMongo {
  if (!globalWithMongo._splitbookMongo) {
    const uri = process.env.MONGODB_URI || undefined;
    globalWithMongo._splitbookMongo = {
      uri,
      client: createClient(uri ?? UNCONFIGURED_URI),
      connecting: null,
    };
  }
  return globalWithMongo._splitbookMongo;
}

/**
 * Connect the shared client, once, and hand it to Mongoose. A failure rejects to the caller and
 * is tried again on the next call: a client whose first connect failed keeps a closed topology,
 * and only an explicit connect replaces it.
 */
export function connectMongo(): Promise<MongoClient> {
  const state = shared();
  if (!state.uri)
    return Promise.reject(
      new Error('Please define the MONGODB_URI environment variable in .env.local'),
    );
  if (state.uri !== process.env.MONGODB_URI)
    return Promise.reject(new Error('MONGODB_URI changed after the database client was made'));
  state.connecting ??= state.client
    .connect()
    .then((client) => {
      // Unless Mongoose was connected on its own first, as a test or a script may do.
      if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected)
        mongoose.connection.setClient(client);
      return client;
    })
    .catch((error: unknown) => {
      state.connecting = null;
      throw error;
    });
  return state.connecting;
}

/**
 * The database MONGODB_URI names, on the shared client, for Better Auth's adapter. Mongoose's
 * driver is the app's own, one mongodb for both (#849).
 */
export function getAuthDb(): Db {
  return shared().client.db();
}

type AuthAdapter = ReturnType<typeof mongodbAdapter>;

/** Better Auth's adapter, connecting the shared client before each of its calls. */
export function connectedAuthAdapter(adapter: AuthAdapter): AuthAdapter {
  return (options) => {
    const base = adapter(options);
    return Object.fromEntries(
      Object.entries(base).map(([key, value]) => [
        key,
        typeof value === 'function'
          ? async (...args: unknown[]) => {
              await connectMongo();
              return Reflect.apply(value, base, args);
            }
          : value,
      ]),
    ) as typeof base;
  };
}
