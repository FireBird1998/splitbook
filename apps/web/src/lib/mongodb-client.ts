// The app's one MongoDB client per server instance, shared by Mongoose (`lib/db.ts`) and Better
// Auth's adapter (#826). Building it doesn't connect, so it is safe at import time (including
// `next build`, where MONGODB_URI may be absent). Connecting goes through `connectMongo()`.
//
// It is also the app's one policy for a database it can't reach: the timeouts, the one retry,
// and what counts as unreachable (`isDatabaseUnreachable`), which every API and page answers
// with "Couldn't reach Splitbook. Try again." (#826, #858, #862).

import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { attachDatabasePool } from '@vercel/functions';
import type { mongodbAdapter } from 'better-auth/adapters/mongodb';
import type { Db } from 'mongodb';
import mongoose from 'mongoose';
import {
  DATABASE_UNAVAILABLE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from '@splitbook/shared/database-unavailable';
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

/**
 * When the database briefly drops, a request tries once more; if that fails too, the member is
 * told "Couldn't reach Splitbook. Try again." within about 5 s of the request's start (the owner's
 * decision of 2026-11-05, for #826, #858 and #862). The second try waits 1 s, so a blip of about
 * a second is ridden out, and is skipped when it couldn't finish within the 5 s.
 */
export const DATABASE_RETRY = {
  afterMs: 1_000,
  answerWithinMs: MONGO_CONNECTION_OPTIONS.serverSelectionTimeoutMS,
} as const;

/**
 * The database couldn't be reached, even after the one retry. Every API answers it as 503
 * DATABASE_UNAVAILABLE, and a server page's error boundary knows it by its digest, which Next.js
 * keeps on an error a server component throws, where it hides the message (`app/error.tsx`).
 */
export class DatabaseUnavailableError extends Error {
  readonly code = DATABASE_UNAVAILABLE;
  readonly digest = DATABASE_UNAVAILABLE;
  constructor(cause: unknown) {
    super(DATABASE_UNAVAILABLE_MESSAGE, { cause });
    this.name = 'DatabaseUnavailableError';
  }
}

const { mongo } = mongoose;

/**
 * Whether an error, or one it was caused by, means the database couldn't be reached: no server
 * to select, a connection that couldn't be opened or broke, a pool cleared after one did, a
 * server shedding load, or a Mongoose call that waited out a connection. Nothing else is: a
 * refusal, a duplicate key or a bug is still answered as itself.
 */
export function isDatabaseUnreachable(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; cause instanceof Error && depth < 8; depth += 1) {
    if (
      cause instanceof DatabaseUnavailableError ||
      cause instanceof mongo.MongoServerSelectionError ||
      cause instanceof mongoose.Error.MongooseServerSelectionError ||
      // A pool cleared because a connection failed is one too.
      cause instanceof mongo.MongoNetworkError ||
      cause instanceof mongo.MongoTopologyClosedError ||
      (cause instanceof mongo.MongoError &&
        cause.hasErrorLabel(mongo.MongoErrorLabel.SystemOverloadedError)) ||
      (cause.name === 'MongooseError' && cause.message.includes('buffering timed out'))
    )
      return true;
    cause = cause.cause;
  }
  return false;
}

// A syntactically valid placeholder so an unconfigured build still constructs
// the auth instance; any database call would fail loudly at request time.
const UNCONFIGURED_URI = 'mongodb://127.0.0.1:27017/splitbook-unconfigured';

type MongoClient = mongoose.mongo.MongoClient;

interface SharedMongo {
  uri: string | undefined;
  client: MongoClient;
  connecting: Promise<MongoClient> | null;
  /** When a connection last left the pool or came back to it; 0 for never, or since a clear. */
  poolUsedAt: number;
  /** The check that the database answers (`reachDatabase`), while one runs. */
  reaching: Promise<MongoClient> | null;
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
    const state: SharedMongo = {
      uri,
      client: createClient(uri ?? UNCONFIGURED_URI),
      connecting: null,
      poolUsedAt: 0,
      reaching: null,
    };
    const used = () => {
      state.poolUsedAt = Date.now();
    };
    state.client.on('connectionCheckedOut', used);
    state.client.on('connectionCheckedIn', used);
    state.client.on('connectionPoolCleared', () => {
      state.poolUsedAt = 0;
    });
    globalWithMongo._splitbookMongo = state;
  }
  return globalWithMongo._splitbookMongo;
}

/**
 * Connect the shared client, once, and hand it to Mongoose. A failure rejects to the caller and
 * is tried again on the next call: a client whose first connect failed keeps a closed topology,
 * and only an explicit connect replaces it.
 */
function connectOnce(state: SharedMongo): Promise<MongoClient> {
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
 * An idle connection closes after `maxIdleTimeMS`, so a pool unused for nearly that long may have
 * none left, and the request's first call would have to open one.
 */
const POOL_WARM_FOR_MS = MONGO_CONNECTION_OPTIONS.maxIdleTimeMS - 1_000;

function poolWarm(state: SharedMongo): boolean {
  return Date.now() - state.poolUsedAt < POOL_WARM_FOR_MS;
}

/**
 * The database gave no answer: unreachable, or an operation's own time ran out first, as a save's
 * transaction can while its connection keeps dropping. Every API answers both as 503
 * DATABASE_UNAVAILABLE (`serverError`).
 */
export function isDatabaseNoAnswer(error: unknown): boolean {
  return isDatabaseUnreachable(error) || error instanceof mongo.MongoOperationTimeoutError;
}

/**
 * The owner's one retry (`DATABASE_RETRY`): `attempt` runs, and if the database gave no answer,
 * runs once more 1 s later, when that still leaves it time. It gets the deadline to finish by,
 * about 5 s from the start. A second failure, or no time for one, is a `DatabaseUnavailableError`;
 * any other error is the caller's, as it is, with no retry.
 */
export async function withDatabaseRetry<T>(attempt: (deadline: number) => Promise<T>): Promise<T> {
  const deadline = Date.now() + DATABASE_RETRY.answerWithinMs;
  try {
    return await attempt(deadline);
  } catch (first) {
    if (!isDatabaseNoAnswer(first)) throw first;
    if (deadline - Date.now() <= DATABASE_RETRY.afterMs) throw new DatabaseUnavailableError(first);
    await new Promise((resolve) => setTimeout(resolve, DATABASE_RETRY.afterMs));
    try {
      return await attempt(deadline);
    } catch (second) {
      throw isDatabaseNoAnswer(second) ? new DatabaseUnavailableError(second) : second;
    }
  }
}

/**
 * Before a request opens a connection, the database is checked with a ping, and the check takes
 * the one retry (#862). Since mongodb 7.7 (#849), a connection the database refuses to open
 * fails a call at once: the driver retries it within 0.6 s and fails again, so a 1 s blip failed
 * the first request after the pool went idle. The ping writes nothing, so the request's own
 * calls still run once, after the database answered: a save is never sent twice. A database that
 * drops later, mid-request, fails that call within the driver's own 5 s, and
 * `isDatabaseUnreachable` says so.
 */
function reachDatabase(state: SharedMongo): Promise<MongoClient> {
  return withDatabaseRetry(async (deadline) => {
    const client = await connectOnce(state);
    if (!poolWarm(state))
      await client
        .db('admin')
        .command({ ping: 1 }, { timeoutMS: Math.max(1, deadline - Date.now()) });
    return client;
  });
}

/**
 * The shared client, connected, with a database that answers (`reachDatabase`). Every database
 * call goes through here first: Mongoose's through `connectDB()`, Better Auth's through
 * `connectedAuthAdapter`. Calls made together share one check.
 */
export function connectMongo(): Promise<MongoClient> {
  const state = shared();
  if (!state.uri)
    return Promise.reject(
      new Error('Please define the MONGODB_URI environment variable in .env.local'),
    );
  if (state.uri !== process.env.MONGODB_URI)
    return Promise.reject(new Error('MONGODB_URI changed after the database client was made'));
  if (state.connecting && poolWarm(state)) return state.connecting;
  state.reaching ??= reachDatabase(state).finally(() => {
    state.reaching = null;
  });
  return state.reaching;
}

/**
 * The database MONGODB_URI names, on the shared client, for Better Auth's adapter. Mongoose's
 * driver is the app's own, one mongodb for both (#849).
 */
export function getAuthDb(): Db {
  return shared().client.db();
}

type AuthAdapter = ReturnType<typeof mongodbAdapter>;

/**
 * Better Auth answers a failure of its adapter as its own 500, or throws its own "Failed to get
 * session", and drops what caused it. A watch notes, for the work it runs, the first time the
 * adapter met a database it couldn't reach, so its caller can still answer that as itself.
 */
export class AuthDatabaseWatch {
  unreachable: unknown = undefined;

  run<T>(work: () => Promise<T>): Promise<T> {
    return authWatches.run(this, work);
  }

  /** What to throw for `error` from the work: the database's failure, when it met one. */
  failure(error: unknown): unknown {
    const cause = this.unreachable ?? (isDatabaseUnreachable(error) ? error : undefined);
    if (cause === undefined) return error;
    return cause instanceof DatabaseUnavailableError ? cause : new DatabaseUnavailableError(cause);
  }
}

const authWatches = new AsyncLocalStorage<AuthDatabaseWatch>();

/** Better Auth's adapter, connecting the shared client before each of its calls. */
export function connectedAuthAdapter(adapter: AuthAdapter): AuthAdapter {
  return (options) => {
    const base = adapter(options);
    return Object.fromEntries(
      Object.entries(base).map(([key, value]) => [
        key,
        typeof value === 'function'
          ? async (...args: unknown[]) => {
              try {
                await connectMongo();
                return await Reflect.apply(value, base, args);
              } catch (error) {
                const watch = authWatches.getStore();
                if (watch && watch.unreachable === undefined && isDatabaseUnreachable(error))
                  watch.unreachable = error;
                throw error;
              }
            }
          : value,
      ]),
    ) as typeof base;
  };
}
