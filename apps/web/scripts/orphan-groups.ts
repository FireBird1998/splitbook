/** Defaults to read-only. Never prints connection strings or financial records. */
import { config } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { inventoryOrphanGroups } from '../src/lib/group-cleanup';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });
async function main() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') {
      console.log(
        'Usage: pnpm web groups:orphans --environment NAME --database NAME [--output report.json]',
      );
      return;
    }
    if (flag === '--dry-run') continue;
    if (
      !['--environment', '--database', '--output'].includes(flag) ||
      !args[index + 1] ||
      args[index + 1].startsWith('--') ||
      options[flag]
    )
      throw new Error(`Unknown, duplicate or incomplete argument: ${flag}`);
    options[flag] = args[++index];
  }
  const environment = options['--environment'];
  const database = options['--database'];
  if (!environment || !database || ['admin', 'config', 'local'].includes(database))
    throw new Error('Specify --environment and an application --database');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const uriDatabase = decodeURIComponent(new URL(uri).pathname.slice(1));
  if (uriDatabase !== database)
    throw new Error('Explicit database does not match the connection target');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const report = await inventoryOrphanGroups(client.db(database), environment);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options['--output']) await writeFile(resolve(options['--output']), json, { flag: 'wx' });
    console.log(json);
  } finally {
    await client.close();
  }
}
main().catch(() => {
  console.error(
    'Orphan Group command failed. Check arguments and database access; no connection credentials are logged.',
  );
  process.exitCode = 1;
});
