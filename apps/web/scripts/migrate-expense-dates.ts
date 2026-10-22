/** Default: read-only. See docs/operations/expense-dates-migration.md before --apply. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { directConnectionFor } from '../src/lib/mongodb-uri';
import { migrateExpenseDates } from '../src/lib/migrations/expense-dates';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

async function main() {
  const args = process.argv.slice(2);
  let apply = false;
  let dryRun = false;
  for (const flag of args) {
    if (flag === '--apply') apply = true;
    else if (flag === '--dry-run') dryRun = true;
    else if (flag === '--help') {
      console.log('Usage: pnpm web migrate:expense-dates [--dry-run | --apply]');
      console.log(
        'Defaults to a read-only audit. Stop writers and verify a backup before --apply.',
      );
      return;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (apply && dryRun) throw new Error('--apply and --dry-run are mutually exclusive');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI must name the target database');
  const dbName = decodeURIComponent(new URL(uri).pathname.slice(1));
  if (!dbName || ['admin', 'config', 'local'].includes(dbName))
    throw new Error('MONGODB_URI must name an application database');
  console.log(`${apply ? 'Moving Expense dates in' : 'Auditing Expense dates in'} "${dbName}".`);
  const client = new MongoClient(uri, {
    ...directConnectionFor(uri),
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.connect();
    const report = await migrateExpenseDates(client.db(dbName), { apply });
    console.log(JSON.stringify(report, null, 2));
    console.log(
      apply
        ? `Moved ${report.moved} of ${report.planned} Expenses to midnight UTC on their day.`
        : `${report.planned} of ${report.scanned} Expenses would move to midnight UTC on their day.`,
    );
    if (report.lateInUtcDay)
      console.log(
        `${report.lateInUtcDay} of them were stored at 22:00 UTC or later: a member 13 or 14 hours ahead of UTC may see those a day earlier than they picked.`,
      );
    if (report.issues.length) {
      console.error('Some Expenses need review before any date moves; nothing was guessed.');
      process.exitCode = 2;
    } else if (apply) {
      const verification = await migrateExpenseDates(client.db(dbName));
      console.log(JSON.stringify({ verification }, null, 2));
      if (verification.planned || verification.issues.length)
        throw new Error('Expense dates remain to move; keep writers stopped and audit again');
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Expense date migration failed');
  process.exitCode = 1;
});
