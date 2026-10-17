/**
 * Vitest global setup: the test server keeps no snapshot history while the suite runs, and
 * gets its own setting back afterwards (#470).
 *
 * Every collection and index is a file mongod keeps open, about 35 per test database, and a
 * dropped database's files stay open until a checkpoint passes the drop and the drop leaves
 * the snapshot history window (`minSnapshotHistoryWindowInSeconds`, 300 s by default). A run
 * drops about 45 databases in under a minute, so with the default window every file stays
 * open and a mongod with the default soft limit (nofile 1024) aborts. With no history, the
 * checkpoint each teardown in `integration-db.ts` forces closes a dropped database's files
 * straight away.
 *
 * The setting is server-wide, and locally TEST_MONGODB_URI usually names the shared server
 * that also holds the demo database, so the teardown puts back the value it found. Without
 * TEST_MONGODB_URI, as in a unit-only run, it touches nothing. Two runs that overlap on one
 * server can leave it at 0: the later one finds the earlier one's 0 and restores that.
 */

import { MongoClient, type Document } from 'mongodb';

const HISTORY_WINDOW = 'minSnapshotHistoryWindowInSeconds';

async function adminCommand(uri: string, command: Document): Promise<Document> {
  const client = new MongoClient(uri);
  try {
    return await client.db('admin').command(command);
  } finally {
    await client.close();
  }
}

export default async function keepNoSnapshotHistoryDuringTheRun() {
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri) return;
  const found = await adminCommand(uri, { getParameter: 1, [HISTORY_WINDOW]: 1 });
  await adminCommand(uri, { setParameter: 1, [HISTORY_WINDOW]: 0 });
  return async () => {
    await adminCommand(uri, { setParameter: 1, [HISTORY_WINDOW]: found[HISTORY_WINDOW] });
  };
}
