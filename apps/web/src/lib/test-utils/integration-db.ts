/**
 * Isolated MongoDB wiring for integration tests.
 *
 * Strategy: every integration test file gets its OWN database on the shared
 * local/CI MongoDB instance, named `splitbook-test-<file key>`. Per-file
 * databases let Vitest run files in parallel without cross-file clobbering,
 * and each file drops its database on teardown.
 *
 * The demo database (`splitbook-demo`) is never touched: the resolved
 * database name must carry the `splitbook-test` prefix and the helper
 * hard-fails on lookalike names (anything containing "demo"/"prod").
 *
 * Connection string comes from TEST_MONGODB_URI (any database segment is
 * replaced with the per-file name) and defaults to local MongoDB.
 *
 * Every collection and index is a file mongod keeps open, about 35 per database,
 * and a dropped database's files stay open until a checkpoint passes the drop
 * and the drop leaves the snapshot history window (300 s by default). A run
 * drops about 45 databases in under a minute, so with the defaults every file
 * stays open and a mongod with the default soft limit (nofile 1024) aborts
 * (#470). The test server keeps no snapshot history, and each teardown forces
 * a checkpoint, so a dropped database's files close straight away.
 */

import mongoose from 'mongoose';
import connectDB from '@/lib/db';

const DEFAULT_BASE_URI = 'mongodb://127.0.0.1:27017/?directConnection=true';
const TEST_DB_PREFIX = 'splitbook-test';
const FORBIDDEN_NAME_PATTERN = /demo|prod|live|stage/i;

export interface IntegrationTestDb {
  /** Fully resolved connection string including the per-file database. */
  uri: string;
  /** Per-file database name, e.g. `splitbook-test-expense`. */
  dbName: string;
  /** Point MONGODB_URI at the test database and open the Mongoose connection. */
  connect: () => Promise<void>;
  /** Delete every document in every collection (indexes stay intact). */
  reset: () => Promise<void>;
  /** Drop the per-file database and disconnect. */
  teardown: () => Promise<void>;
}

function withDatabaseName(baseUri: string, dbName: string): string {
  const url = new URL(baseUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function assertSafeTestDatabase(dbName: string, uri: string): void {
  if (!dbName.startsWith(`${TEST_DB_PREFIX}-`)) {
    throw new Error(
      `Integration tests require a "${TEST_DB_PREFIX}-*" database name, got "${dbName}".`,
    );
  }
  if (FORBIDDEN_NAME_PATTERN.test(dbName) || FORBIDDEN_NAME_PATTERN.test(uri)) {
    throw new Error(
      `Refusing to run integration tests against "${dbName}" — test databases must not ` +
        `resemble demo or production databases.`,
    );
  }
}

export function integrationTestDb(fileKey: string): IntegrationTestDb {
  const safeKey = fileKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const dbName = `${TEST_DB_PREFIX}-${safeKey}`;
  const baseUri = process.env.TEST_MONGODB_URI ?? DEFAULT_BASE_URI;
  const uri = withDatabaseName(baseUri, dbName);

  assertSafeTestDatabase(dbName, uri);

  return {
    uri,
    dbName,
    connect: async () => {
      process.env.MONGODB_URI = uri;
      await connectDB();
      await mongoose.connection.db
        ?.admin()
        .command({ setParameter: 1, minSnapshotHistoryWindowInSeconds: 0 });
    },
    reset: async () => {
      const db = mongoose.connection.db;
      if (!db) throw new Error('Integration test database is not connected');
      const collections = await db.collections();
      await Promise.all(collections.map((collection) => collection.deleteMany({})));
    },
    teardown: async () => {
      const db = mongoose.connection.db;
      if (db) {
        await db.dropDatabase();
        await db.admin().command({ fsync: 1 });
      }
      await mongoose.disconnect();
    },
  };
}
