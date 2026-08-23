/**
 * Idempotent demo seed CLI.
 * Usage: pnpm demo:seed
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const { seedDemoData, disconnectDemoDb } = await import('../src/lib/demo/seed');

  console.log('Seeding demo data…');
  console.log(`MONGODB_URI database: ${summarizeUri(process.env.MONGODB_URI)}`);

  try {
    const result = await seedDemoData();
    console.log('Demo seed complete:');
    console.log(`  users upserted:       ${result.usersUpserted}`);
    console.log(`  group created:        ${result.groupCreated}`);
    console.log(`  members ensured:      ${result.membersEnsured}`);
    console.log(`  tags ensured:         ${result.tagsEnsured}`);
    console.log(`  expenses created:     ${result.expensesCreated}`);
    console.log(`  settlements created:  ${result.settlementsCreated}`);
    if (result.skippedTransactions) {
      console.log('  (expenses/settlements already present — skipped to stay idempotent)');
    }
    console.log('\nStart the app with AUTH_MODE=demo and open http://localhost:3000');
  } finally {
    await disconnectDemoDb();
  }
}

function summarizeUri(uri: string | undefined): string {
  if (!uri) return '(missing MONGODB_URI)';
  try {
    const parsed = new URL(uri);
    return `${parsed.pathname.replace(/^\//, '') || '(default)'} @ ${parsed.hostname}:${parsed.port || '27017'}`;
  } catch {
    return '(unparseable URI)';
  }
}

main().catch((err) => {
  console.error('\nDemo seed failed.');
  if (isConnectionError(err)) {
    console.error(`
MongoDB is not reachable. Start it locally, then re-run:

  docker run -d --name split-mongo -p 27017:27017 mongo:7
  # or if the container already exists:
  docker start split-mongo

Point MONGODB_URI at a dedicated demo database, e.g.:
  mongodb://localhost:27017/splitbook-demo?directConnection=true
`);
  }
  console.error(err);
  process.exit(1);
});

function isConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('ECONNREFUSED') ||
    message.includes('MongoNetworkError') ||
    message.includes('querySrv') ||
    message.includes('connect ECONNREFUSED')
  );
}
