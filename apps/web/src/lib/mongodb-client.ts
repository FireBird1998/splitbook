// The app's one MongoDB client per server instance, shared by Mongoose (`lib/db.ts`) and Better
// Auth's adapter (#826). Building it doesn't connect, so it is safe at import time (including
// `next build`, where MONGODB_URI may be absent). Connecting goes through `connectMongo()`.

import 'server-only';
import { attachDatabasePool } from '@vercel/functions';
import type { mongodbAdapter } from 'better-auth/adapters/mongodb';
import type { Db } from 'mongodb';
import mongoose from 'mongoose';

/**
 * How the client connects, as the owner confirmed in #826's grilling (2026-10-22): a page waits
 * at most 5 s for a server, an instance keeps at most 10 connections, and an idle one closes
 * after 5 s.
 */
export const MONGO_CONNECTION_OPTIONS = {
  serverSelectionTimeoutMS: 5_000,
  maxPoolSize: 10,
  maxIdleTimeMS: 5_000,
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
  // Mongoose's own driver, as `setClient()` takes no other. The database is the URI's path.
  const client = new mongoose.mongo.MongoClient(uri, {
    ...MONGO_CONNECTION_OPTIONS,
    // directConnection is needed for the local Docker Mongo but is rejected by mongodb+srv:// (Atlas)
    ...(uri.startsWith('mongodb+srv://') ? {} : { directConnection: true }),
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
 * The database MONGODB_URI names, on the shared client, for Better Auth's adapter. The adapter's
 * types come from the app's mongodb 7.1 and the client is Mongoose's 7.0 driver, hence the cast:
 * the adapter supports mongodb ^6 || ^7 and only calls `db.collection()` (and, for transactions,
 * which are off, `startSession()`), and both drivers use one bson, so its ids are one class.
 */
export function getAuthDb(): Db {
  return shared().client.db() as unknown as Db;
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
