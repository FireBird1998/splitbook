/**
 * Auth.js → Better Auth data migration CLI.
 *
 * Usage:
 *   pnpm web migrate:auth              # migrate the database named in MONGODB_URI
 *   pnpm web migrate:auth --dry-run    # report the plan, write nothing
 *   pnpm web migrate:auth --revert     # rollback path (accepts --dry-run too)
 *
 * What it does is documented in src/lib/auth/migrate-auth.ts. The script is
 * idempotent and refuses `splitbook-test-*` databases.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { MongoClient } from 'mongodb';
import {
  databaseNameFromUri,
  migrateAuthData,
  revertAuthMigration,
  TEST_DATABASE_PATTERN,
} from '../src/lib/auth/migrate-auth';

config({ path: resolve(process.cwd(), '.env.local') });

const KNOWN_FLAGS = new Set(['--dry-run', '--revert']);

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !KNOWN_FLAGS.has(arg));
  if (unknown.length) {
    throw new Error(`Unknown argument(s): ${unknown.join(' ')}. Use --dry-run and/or --revert.`);
  }
  const dryRun = args.includes('--dry-run');
  const revert = args.includes('--revert');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (put it in apps/web/.env.local).');
  const dbName = databaseNameFromUri(uri);
  if (!dbName) throw new Error('MONGODB_URI must name a database, e.g. mongodb://host/splitbook');
  if (TEST_DATABASE_PATTERN.test(dbName)) {
    throw new Error(`Refusing to migrate test database "${dbName}".`);
  }

  console.log(
    `${revert ? 'Reverting' : 'Migrating'} auth data in "${dbName}"${dryRun ? ' (dry run)' : ''}…`,
  );

  const client = new MongoClient(uri, {
    ...(uri.startsWith('mongodb+srv://') ? {} : { directConnection: true }),
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  try {
    const db = client.db(dbName);
    if (revert) {
      const report = await revertAuthMigration(db, { dryRun });
      console.log(`  users:                          ${report.users.total}`);
      console.log(`  emailVerified true → Date:      ${report.users.emailVerifiedToDate}`);
      console.log(`  emailVerified false → null:     ${report.users.emailVerifiedToNull}`);
      console.log(
        `  Better Auth accounts set aside: ${report.accounts.betterAuthRowsMovedAside ? 'yes' : 'no'}`,
      );
      console.log(
        `  Auth.js accounts restored:      ${report.accounts.backupRestored ? 'yes' : 'no'}`,
      );
      console.log(`  users.email index:              ${report.emailIndex}`);
    } else {
      const report = await migrateAuthData(db, { dryRun });
      console.log(`  users:                          ${report.users.total}`);
      console.log(`  emailVerified Date → true:      ${report.users.emailVerifiedFromDate}`);
      console.log(
        `  emailVerified via Google row:   ${report.users.emailVerifiedFromGoogleAccount}`,
      );
      console.log(`  emailVerified empty → false:    ${report.users.emailVerifiedFromEmpty}`);
      console.log(`  timestamps added:               ${report.users.timestampsAdded}`);
      console.log(
        `  Auth.js accounts backed up:     ${report.accounts.renamedToBackup ? 'yes' : 'no'} (${report.accounts.backedUp} rows in backup)`,
      );
      console.log(`  users.email index:              ${report.emailIndex}`);
    }
    console.log(dryRun ? '\nDry run — nothing was written.' : '\nDone.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('\nAuth migration failed.');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
