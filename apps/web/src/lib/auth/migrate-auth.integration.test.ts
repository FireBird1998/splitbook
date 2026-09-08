/**
 * Integration test for the Auth.js → Better Auth data migration against an
 * isolated MongoDB database (`splitbook-test-auth-migration`). Uses the
 * native driver directly, like the CLI does.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  ACCOUNTS_AUTHJS_BACKUP_COLLECTION,
  ACCOUNTS_BETTER_AUTH_BACKUP_COLLECTION,
  ACCOUNTS_COLLECTION,
  LEGACY_USERS_EMAIL_INDEX,
  USERS_COLLECTION,
  USERS_EMAIL_INDEX,
} from '@/lib/auth/collections';
import {
  databaseNameFromUri,
  migrateAuthData,
  revertAuthMigration,
  TEST_DATABASE_PATTERN,
} from '@/lib/auth/migrate-auth';

const target = integrationTestDb('auth-migration');
let client: MongoClient;
let db: Db;

const VERIFIED_ID = new ObjectId('a00000000000000000000001');
const UNVERIFIED_ID = new ObjectId('a00000000000000000000002');
const LEGACY_ID = new ObjectId('a00000000000000000000003');
// A genuine ObjectId minted at a known time, as the Auth.js adapter would have.
const REAL_ID = ObjectId.createFromTime(Math.floor(Date.parse('2026-03-04T05:06:07Z') / 1000));
const VERIFIED_AT = new Date('2026-01-02T03:04:05.000Z');

beforeAll(async () => {
  client = new MongoClient(target.uri, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  db = client.db(target.dbName);
});

beforeEach(async () => {
  await db.dropDatabase();
  await db.collection(USERS_COLLECTION).insertMany([
    {
      _id: VERIFIED_ID,
      name: 'Verified',
      email: 'verified@example.com',
      emailVerified: VERIFIED_AT,
      preferredCurrency: 'INR',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      _id: UNVERIFIED_ID,
      name: 'Unverified',
      email: 'unverified@example.com',
      emailVerified: null,
      preferredCurrency: 'INR',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      // Inserted outside Mongoose (as the expense-access suite does): no
      // emailVerified and no timestamps at all.
      _id: LEGACY_ID,
      name: 'Legacy',
      email: 'legacy@example.com',
      preferredCurrency: 'INR',
    },
    {
      // Created by the Auth.js adapter: no timestamps, emailVerified null.
      _id: REAL_ID,
      name: 'Real',
      email: 'real@example.com',
      emailVerified: null,
    },
  ]);
  await db
    .collection(USERS_COLLECTION)
    .createIndex({ email: 1 }, { unique: true, name: LEGACY_USERS_EMAIL_INDEX });
  await db.collection(ACCOUNTS_COLLECTION).insertOne({
    userId: VERIFIED_ID,
    type: 'oidc',
    provider: 'google',
    providerAccountId: '1234567890',
    access_token: 'ya29.example',
  });
});

afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});

async function indexNames(collection: string): Promise<string[]> {
  return (await db.collection(collection).indexes()).map((index) => index.name as string).sort();
}

async function collectionNames(): Promise<string[]> {
  return (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((collection) => collection.name)
    .sort();
}

describe('migrateAuthData', () => {
  it('converts emailVerified, ensures timestamps, backs up accounts and renames the index', async () => {
    const before = Date.now();
    const report = await migrateAuthData(db);

    expect(report).toEqual({
      dryRun: false,
      users: {
        total: 4,
        emailVerifiedFromDate: 1,
        emailVerifiedFromEmpty: 3,
        timestampsAdded: 2,
      },
      accounts: { renamedToBackup: true, backedUp: 1 },
      emailIndex: 'renamed',
    });

    const byId = async (id: ObjectId) => db.collection(USERS_COLLECTION).findOne({ _id: id });
    const verified = await byId(VERIFIED_ID);
    const unverified = await byId(UNVERIFIED_ID);
    const legacy = await byId(LEGACY_ID);
    const real = await byId(REAL_ID);
    expect(verified?.emailVerified).toBe(true);
    expect(unverified?.emailVerified).toBe(false);
    expect(legacy?.emailVerified).toBe(false);
    expect(real?.emailVerified).toBe(false);
    // Ids, names and app fields are untouched.
    expect([verified, unverified, legacy].map((user) => user?.preferredCurrency)).toEqual([
      'INR',
      'INR',
      'INR',
    ]);
    expect(await db.collection(USERS_COLLECTION).countDocuments({ name: 'Verified' })).toBe(1);
    // Synthetic persona-style ids decode to a pre-1970 timestamp, so they get "now".
    expect(legacy?.createdAt).toBeInstanceOf(Date);
    expect((legacy?.createdAt as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(legacy?.updatedAt).toBeInstanceOf(Date);
    // A genuine ObjectId keeps the moment Auth.js minted it.
    expect(real?.createdAt).toEqual(REAL_ID.getTimestamp());
    expect(real?.updatedAt).toBeInstanceOf(Date);
    // Existing timestamps are preserved.
    expect(verified?.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));

    expect(await collectionNames()).toEqual([ACCOUNTS_AUTHJS_BACKUP_COLLECTION, USERS_COLLECTION]);
    expect(
      await db
        .collection(ACCOUNTS_AUTHJS_BACKUP_COLLECTION)
        .findOne({ providerAccountId: '1234567890' }),
    ).not.toBeNull();

    expect(await indexNames(USERS_COLLECTION)).toEqual(['_id_', USERS_EMAIL_INDEX]);
    const emailIndex = (await db.collection(USERS_COLLECTION).indexes()).find(
      (index) => index.name === USERS_EMAIL_INDEX,
    );
    expect(emailIndex).toMatchObject({ key: { email: 1 }, unique: true });
  });

  it('is idempotent: a second run changes nothing', async () => {
    await migrateAuthData(db);
    const second = await migrateAuthData(db);

    expect(second).toEqual({
      dryRun: false,
      users: { total: 4, emailVerifiedFromDate: 0, emailVerifiedFromEmpty: 0, timestampsAdded: 0 },
      accounts: { renamedToBackup: false, backedUp: 1 },
      emailIndex: 'unchanged',
    });
  });

  it('reports the plan without writing under --dry-run', async () => {
    const report = await migrateAuthData(db, { dryRun: true });

    expect(report).toEqual({
      dryRun: true,
      users: { total: 4, emailVerifiedFromDate: 1, emailVerifiedFromEmpty: 3, timestampsAdded: 2 },
      accounts: { renamedToBackup: true, backedUp: 1 },
      emailIndex: 'renamed',
    });
    const verified = await db.collection(USERS_COLLECTION).findOne({ _id: VERIFIED_ID });
    expect(verified?.emailVerified).toEqual(VERIFIED_AT);
    expect(await collectionNames()).toEqual([ACCOUNTS_COLLECTION, USERS_COLLECTION]);
    expect(await indexNames(USERS_COLLECTION)).toEqual(['_id_', LEGACY_USERS_EMAIL_INDEX]);
  });

  it('creates the Better Auth index name on a database that never had the legacy one', async () => {
    await db.collection(USERS_COLLECTION).dropIndex(LEGACY_USERS_EMAIL_INDEX);

    const report = await migrateAuthData(db);

    expect(report.emailIndex).toBe('created');
    expect(await indexNames(USERS_COLLECTION)).toEqual(['_id_', USERS_EMAIL_INDEX]);
  });

  it('leaves a Better Auth shaped accounts collection alone', async () => {
    await db.collection(ACCOUNTS_COLLECTION).deleteMany({});
    await db.collection(ACCOUNTS_COLLECTION).insertOne({
      userId: VERIFIED_ID,
      providerId: 'google',
      accountId: '1234567890',
    });

    const report = await migrateAuthData(db);

    expect(report.accounts).toEqual({ renamedToBackup: false, backedUp: 0 });
    expect(await collectionNames()).toEqual([ACCOUNTS_COLLECTION, USERS_COLLECTION]);
  });
});

describe('revertAuthMigration', () => {
  it('restores the Auth.js shape after a migration', async () => {
    await migrateAuthData(db);
    // Better Auth wrote an account row after the migration.
    await db.collection(ACCOUNTS_COLLECTION).insertOne({
      userId: VERIFIED_ID,
      providerId: 'google',
      accountId: '1234567890',
    });

    const before = Date.now();
    const report = await revertAuthMigration(db);

    expect(report).toEqual({
      dryRun: false,
      users: { total: 4, emailVerifiedToDate: 1, emailVerifiedToNull: 3 },
      accounts: { betterAuthRowsMovedAside: true, backupRestored: true },
      emailIndex: 'renamed',
    });

    const verified = await db.collection(USERS_COLLECTION).findOne({ _id: VERIFIED_ID });
    expect(verified?.emailVerified).toBeInstanceOf(Date);
    expect((verified?.emailVerified as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    for (const id of [UNVERIFIED_ID, LEGACY_ID, REAL_ID]) {
      const user = await db.collection(USERS_COLLECTION).findOne({ _id: id });
      expect(user?.emailVerified).toBeNull();
    }

    expect(await collectionNames()).toEqual([
      ACCOUNTS_COLLECTION,
      ACCOUNTS_BETTER_AUTH_BACKUP_COLLECTION,
      USERS_COLLECTION,
    ]);
    expect(
      await db.collection(ACCOUNTS_COLLECTION).findOne({ providerAccountId: '1234567890' }),
    ).not.toBeNull();
    expect(await indexNames(USERS_COLLECTION)).toEqual(['_id_', LEGACY_USERS_EMAIL_INDEX]);
  });

  it('is idempotent and dry-run aware', async () => {
    await migrateAuthData(db);
    await revertAuthMigration(db);

    const dry = await revertAuthMigration(db, { dryRun: true });
    expect(dry.users).toEqual({ total: 4, emailVerifiedToDate: 0, emailVerifiedToNull: 0 });
    expect(dry.emailIndex).toBe('unchanged');

    const second = await revertAuthMigration(db);
    expect(second.users).toEqual({ total: 4, emailVerifiedToDate: 0, emailVerifiedToNull: 0 });
    expect(second.accounts).toEqual({ betterAuthRowsMovedAside: false, backupRestored: false });
    expect(second.emailIndex).toBe('unchanged');
  });
});

describe('CLI guards', () => {
  it('reads the database name from the connection string', () => {
    expect(databaseNameFromUri('mongodb://localhost:27017/splitbook?directConnection=true')).toBe(
      'splitbook',
    );
    expect(databaseNameFromUri('mongodb+srv://u:p@cluster.example.net/splitbook')).toBe(
      'splitbook',
    );
    expect(databaseNameFromUri('mongodb://localhost:27017/')).toBeNull();
    expect(databaseNameFromUri('not a uri')).toBeNull();
  });

  it('refuses test databases', () => {
    expect(TEST_DATABASE_PATTERN.test(target.dbName)).toBe(true);
    expect(TEST_DATABASE_PATTERN.test('splitbook-test-access-1234')).toBe(true);
    expect(TEST_DATABASE_PATTERN.test('splitbook')).toBe(false);
    expect(TEST_DATABASE_PATTERN.test('splitbook-demo')).toBe(false);
  });
});
