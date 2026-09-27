/** Default: read-only. See docs/operations/ledger-migration.md before --apply. */
import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { z } from 'zod/v4';
import { migrateLedger } from '../src/lib/migrations/ledger';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const mappingSchema = z.array(
  z
    .object({
      groupId: z.string().regex(/^[a-fA-F0-9]{24}$/),
      legacyTag: z.string().min(1),
      tagId: z.string().regex(/^[a-fA-F0-9]{24}$/),
    })
    .strict(),
);

async function main() {
  const args = process.argv.slice(2);
  let apply = false;
  let dryRun = false;
  let mappingPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--apply') apply = true;
    else if (flag === '--dry-run') dryRun = true;
    else if (flag === '--tag-mappings' && args[index + 1] && !args[index + 1].startsWith('--')) {
      if (mappingPath) throw new Error('Specify --tag-mappings once');
      mappingPath = args[++index];
    } else if (flag === '--help') {
      console.log(
        'Usage: pnpm web migrate:ledger [--dry-run | --apply] [--tag-mappings path.json]',
      );
      console.log(
        'Defaults to a read-only audit. Stop writers and verify a backup before --apply.',
      );
      return;
    } else throw new Error(`Unknown or incomplete argument: ${flag}`);
  }
  if (apply && dryRun) throw new Error('--apply and --dry-run are mutually exclusive');
  const mappings = mappingPath
    ? mappingSchema.parse(JSON.parse(await readFile(resolve(mappingPath), 'utf8')))
    : undefined;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI must name the target database');
  const dbName = decodeURIComponent(new URL(uri).pathname.slice(1));
  if (!dbName || ['admin', 'config', 'local'].includes(dbName))
    throw new Error('MONGODB_URI must name an application database');
  console.log(`${apply ? 'Applying migration to' : 'Auditing'} database "${dbName}".`);
  const client = new MongoClient(uri, {
    ...(uri.startsWith('mongodb+srv://') ? {} : { directConnection: true }),
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.connect();
    const report = await migrateLedger(client.db(dbName), { apply, mappings });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'blocked') {
      console.error(
        'Migration blocked. Review reported records; do not guess financial corrections or Tag identity.',
      );
      process.exitCode = 2;
    } else if (apply) {
      const verification = await migrateLedger(client.db(dbName), { mappings });
      console.log(JSON.stringify({ verification }, null, 2));
      if (
        verification.status === 'blocked' ||
        verification.money.planned ||
        verification.tags.collections.expenses.planned ||
        verification.tags.collections.recurringexpenses.planned ||
        verification.metadata.revisionsPlanned ||
        verification.metadata.groupsToLock
      ) {
        throw new Error(
          'Post-migration verification found remaining work; keep writers stopped and audit again',
        );
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Ledger migration failed');
  process.exitCode = 1;
});
