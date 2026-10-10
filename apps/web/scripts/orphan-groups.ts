/** Defaults to read-only. Never prints connection strings or financial records. */
import { config } from 'dotenv';
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { inventoryOrphanGroups } from '../src/lib/group-cleanup';

config({ path: resolve(process.cwd(), '.env.local'), quiet: true });
async function main() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  let apply = false,
    dryRun = false,
    resume = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') {
      console.log(
        'Usage: pnpm web groups:orphans --environment NAME --database NAME [--output report.json] [--manifest reviewed.json [--apply] | --resume --apply]',
      );
      return;
    }
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (flag === '--apply') {
      apply = true;
      continue;
    }
    if (flag === '--resume') {
      resume = true;
      continue;
    }
    if (
      !['--environment', '--database', '--output', '--manifest'].includes(flag) ||
      !args[index + 1] ||
      args[index + 1].startsWith('--') ||
      options[flag]
    )
      throw new Error(`Unknown, duplicate or incomplete argument: ${flag}`);
    options[flag] = args[++index];
  }
  if (
    (resume && !apply) ||
    (apply && dryRun) ||
    (resume && options['--manifest']) ||
    (apply && !options['--manifest'] && !resume)
  )
    throw new Error(
      'Apply requires exactly one reviewed manifest or explicit resume; dry-run/apply are exclusive',
    );
  const environment = options['--environment'];
  const database = options['--database'];
  if (!environment || !database || ['admin', 'config', 'local'].includes(database))
    throw new Error('Specify --environment and an application --database');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const uriDatabase = decodeURIComponent(new URL(uri).pathname.slice(1));
  if (uriDatabase !== database)
    throw new Error('Explicit database does not match the connection target');
  // Reserve output before any database action. An existing report must never hide
  // a successful destructive apply behind a late filesystem error.
  const output = options['--output'] ? await open(resolve(options['--output']), 'wx') : null;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    let report: unknown;
    if (options['--manifest'] || (resume && apply)) {
      // Importing the service is reserved for explicit maintenance. Ordinary inventory
      // uses only raw reads and never initializes models/indexes or recovery jobs.
      const { applyOrphanGroupManifest, resumeRequestedGroupDeletions } =
        await import('../src/lib/services/group-cleanup.service');
      const { default: mongoose } = await import('mongoose');
      try {
        report = options['--manifest']
          ? await applyOrphanGroupManifest(
              JSON.parse(await readFile(resolve(options['--manifest']), 'utf8')),
              { environment, database, apply },
            )
          : { environment, database, results: await resumeRequestedGroupDeletions() };
      } finally {
        await mongoose.disconnect();
      }
    } else {
      report = await inventoryOrphanGroups(client.db(database), environment);
    }
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (output) await output.writeFile(json);
    console.log(json);
  } finally {
    await client.close();
    await output?.close();
  }
}
main().catch(() => {
  console.error(
    'Orphan Group command failed. Check arguments and database access; no connection credentials are logged.',
  );
  process.exitCode = 1;
});
