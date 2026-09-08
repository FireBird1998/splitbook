/**
 * Prepares the authentication data written by Auth.js for Better Auth, and
 * undoes that preparation for the rollback path. Pure MongoDB driver code so
 * the CLI (`pnpm web migrate:auth`) and the integration test share it.
 *
 * Forward (`migrateAuthData`):
 * 1. `users.emailVerified` becomes a boolean — `true` when a Date was stored,
 *    `false` for null or a missing field. Every other user field, including
 *    `_id`, is untouched.
 * 2. `users.createdAt` / `users.updatedAt` are ensured, because Better Auth
 *    treats them as required. `createdAt` falls back to the ObjectId timestamp
 *    (or to now for synthetic ids whose timestamp bits predate 1970).
 * 3. The Auth.js `accounts` collection (documents carrying `providerAccountId`)
 *    is renamed to `accounts_authjs_backup`. Better Auth creates fresh account
 *    rows and links them to the existing user on the next Google sign-in.
 * 4. The unique `users.email` index moves from Mongoose's `email_1` to the
 *    name Better Auth's adapter expects, `users_email_uidx` (see collections.ts).
 *
 * Revert (`revertAuthMigration`): booleans go back to Date/null (the original
 * timestamp is not kept, so `true` becomes the revert time), the index name
 * returns to `email_1`, Better Auth account rows move to
 * `accounts_betterauth_backup` and the Auth.js backup returns to `accounts`.
 *
 * Both directions are idempotent: re-running reports zero changes.
 */

import type { Db } from 'mongodb';
import {
  ACCOUNTS_AUTHJS_BACKUP_COLLECTION,
  ACCOUNTS_BETTER_AUTH_BACKUP_COLLECTION,
  ACCOUNTS_COLLECTION,
  LEGACY_USERS_EMAIL_INDEX,
  USERS_COLLECTION,
  USERS_EMAIL_INDEX,
} from '@/lib/auth/collections';

export interface MigrateAuthOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean;
}

export type EmailIndexChange = 'renamed' | 'created' | 'unchanged';

export interface MigrateAuthReport {
  dryRun: boolean;
  users: {
    total: number;
    /** Documents whose `emailVerified` was a Date and became `true`. */
    emailVerifiedFromDate: number;
    /** Documents whose `emailVerified` was null/missing/other and became `false`. */
    emailVerifiedFromEmpty: number;
    /** Documents that were missing `createdAt` or `updatedAt`. */
    timestampsAdded: number;
  };
  accounts: {
    /** Whether an Auth.js-shaped `accounts` collection was moved to the backup. */
    renamedToBackup: boolean;
    /** Documents in the Auth.js backup collection after the step. */
    backedUp: number;
  };
  emailIndex: EmailIndexChange;
}

export interface RevertAuthReport {
  dryRun: boolean;
  users: {
    total: number;
    /** `true` values restored to a Date. */
    emailVerifiedToDate: number;
    /** `false` values restored to null. */
    emailVerifiedToNull: number;
  };
  accounts: {
    /** Whether Better Auth account rows were moved aside. */
    betterAuthRowsMovedAside: boolean;
    /** Whether the Auth.js backup collection was restored as `accounts`. */
    backupRestored: boolean;
  };
  emailIndex: EmailIndexChange;
}

async function collectionExists(db: Db, name: string): Promise<boolean> {
  const found = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return found.length > 0;
}

async function indexNames(db: Db, collection: string): Promise<Set<string>> {
  if (!(await collectionExists(db, collection))) return new Set();
  const indexes = await db.collection(collection).indexes();
  return new Set(indexes.map((index) => index.name).filter((name): name is string => !!name));
}

/** Auth.js stored one document per OAuth account with `provider` + `providerAccountId`. */
async function isAuthJsAccountsCollection(db: Db): Promise<boolean> {
  if (!(await collectionExists(db, ACCOUNTS_COLLECTION))) return false;
  const sample = await db
    .collection(ACCOUNTS_COLLECTION)
    .findOne({ providerAccountId: { $exists: true } }, { projection: { _id: 1 } });
  return sample !== null;
}

/**
 * Move the unique `users.email` index from `from` to `to`. Creating the target
 * first would fail with IndexOptionsConflict, so the legacy index is dropped
 * before the new one is created; the unique constraint is re-established in
 * the same step.
 */
async function moveEmailIndex(
  db: Db,
  from: string,
  to: string,
  dryRun: boolean,
): Promise<EmailIndexChange> {
  const existing = await indexNames(db, USERS_COLLECTION);
  if (existing.has(to)) {
    if (existing.has(from) && !dryRun) await db.collection(USERS_COLLECTION).dropIndex(from);
    return existing.has(from) ? 'renamed' : 'unchanged';
  }
  const change: EmailIndexChange = existing.has(from) ? 'renamed' : 'created';
  if (dryRun) return change;
  if (existing.has(from)) await db.collection(USERS_COLLECTION).dropIndex(from);
  await db.collection(USERS_COLLECTION).createIndex({ email: 1 }, { unique: true, name: to });
  return change;
}

export async function migrateAuthData(
  db: Db,
  options: MigrateAuthOptions = {},
): Promise<MigrateAuthReport> {
  const dryRun = options.dryRun ?? false;
  const users = db.collection(USERS_COLLECTION);

  const fromDateFilter = { emailVerified: { $type: 'date' } };
  const fromEmptyFilter = { emailVerified: { $not: { $type: 'bool' } } };
  const timestampsFilter = {
    $or: [{ createdAt: { $exists: false } }, { updatedAt: { $exists: false } }],
  };

  const total = await users.countDocuments({});
  let emailVerifiedFromDate: number;
  let emailVerifiedFromEmpty: number;
  let timestampsAdded: number;

  if (dryRun) {
    emailVerifiedFromDate = await users.countDocuments(fromDateFilter);
    // Everything that is neither a boolean nor a Date.
    emailVerifiedFromEmpty = (await users.countDocuments(fromEmptyFilter)) - emailVerifiedFromDate;
    timestampsAdded = await users.countDocuments(timestampsFilter);
  } else {
    emailVerifiedFromDate = (
      await users.updateMany(fromDateFilter, { $set: { emailVerified: true } })
    ).modifiedCount;
    emailVerifiedFromEmpty = (
      await users.updateMany(fromEmptyFilter, { $set: { emailVerified: false } })
    ).modifiedCount;
    timestampsAdded = (
      await users.updateMany(timestampsFilter, [
        {
          $set: {
            createdAt: {
              $ifNull: [
                '$createdAt',
                // The ObjectId timestamp approximates when Auth.js created the
                // user. `$toDate` reads it as a signed value, so synthetic ids
                // with the high bit set (the demo persona ids) decode before
                // 1970; fall back to now for those.
                {
                  $cond: [
                    { $lt: [{ $toDate: '$_id' }, new Date(0)] },
                    '$$NOW',
                    { $toDate: '$_id' },
                  ],
                },
              ],
            },
            updatedAt: { $ifNull: ['$updatedAt', '$$NOW'] },
          },
        },
      ])
    ).modifiedCount;
  }

  let renamedToBackup = false;
  if (await isAuthJsAccountsCollection(db)) {
    if (await collectionExists(db, ACCOUNTS_AUTHJS_BACKUP_COLLECTION)) {
      throw new Error(
        `Both "${ACCOUNTS_COLLECTION}" (Auth.js shape) and "${ACCOUNTS_AUTHJS_BACKUP_COLLECTION}" exist. ` +
          'Resolve the leftover backup by hand before migrating.',
      );
    }
    if (!dryRun) {
      await db.renameCollection(ACCOUNTS_COLLECTION, ACCOUNTS_AUTHJS_BACKUP_COLLECTION);
    }
    renamedToBackup = true;
  }
  const backedUp = (await collectionExists(db, ACCOUNTS_AUTHJS_BACKUP_COLLECTION))
    ? await db.collection(ACCOUNTS_AUTHJS_BACKUP_COLLECTION).countDocuments({})
    : renamedToBackup && dryRun
      ? await db.collection(ACCOUNTS_COLLECTION).countDocuments({})
      : 0;

  const emailIndex = await moveEmailIndex(db, LEGACY_USERS_EMAIL_INDEX, USERS_EMAIL_INDEX, dryRun);

  return {
    dryRun,
    users: { total, emailVerifiedFromDate, emailVerifiedFromEmpty, timestampsAdded },
    accounts: { renamedToBackup, backedUp },
    emailIndex,
  };
}

export async function revertAuthMigration(
  db: Db,
  options: MigrateAuthOptions = {},
): Promise<RevertAuthReport> {
  const dryRun = options.dryRun ?? false;
  const users = db.collection(USERS_COLLECTION);

  const total = await users.countDocuments({});
  let emailVerifiedToDate: number;
  let emailVerifiedToNull: number;
  if (dryRun) {
    emailVerifiedToDate = await users.countDocuments({ emailVerified: true });
    emailVerifiedToNull = await users.countDocuments({ emailVerified: false });
  } else {
    emailVerifiedToDate = (
      await users.updateMany({ emailVerified: true }, [{ $set: { emailVerified: '$$NOW' } }])
    ).modifiedCount;
    emailVerifiedToNull = (
      await users.updateMany({ emailVerified: false }, { $set: { emailVerified: null } })
    ).modifiedCount;
  }

  let betterAuthRowsMovedAside = false;
  let backupRestored = false;
  const hasAuthJsBackup = await collectionExists(db, ACCOUNTS_AUTHJS_BACKUP_COLLECTION);
  const hasAccounts = await collectionExists(db, ACCOUNTS_COLLECTION);
  if (hasAccounts && !(await isAuthJsAccountsCollection(db))) {
    if (await collectionExists(db, ACCOUNTS_BETTER_AUTH_BACKUP_COLLECTION)) {
      throw new Error(
        `"${ACCOUNTS_BETTER_AUTH_BACKUP_COLLECTION}" already exists. Resolve the leftover backup by hand before reverting.`,
      );
    }
    if (!dryRun) {
      await db.renameCollection(ACCOUNTS_COLLECTION, ACCOUNTS_BETTER_AUTH_BACKUP_COLLECTION);
    }
    betterAuthRowsMovedAside = true;
  }
  if (hasAuthJsBackup && (betterAuthRowsMovedAside || !hasAccounts)) {
    if (!dryRun) await db.renameCollection(ACCOUNTS_AUTHJS_BACKUP_COLLECTION, ACCOUNTS_COLLECTION);
    backupRestored = true;
  }

  const emailIndex = await moveEmailIndex(db, USERS_EMAIL_INDEX, LEGACY_USERS_EMAIL_INDEX, dryRun);

  return {
    dryRun,
    users: { total, emailVerifiedToDate, emailVerifiedToNull },
    accounts: { betterAuthRowsMovedAside, backupRestored },
    emailIndex,
  };
}

/** Database names the CLI refuses, so a test database is never migrated by accident. */
export const TEST_DATABASE_PATTERN = /^splitbook-test/i;

export function databaseNameFromUri(uri: string): string | null {
  try {
    const name = new URL(uri).pathname.replace(/^\//, '');
    return name || null;
  } catch {
    return null;
  }
}
