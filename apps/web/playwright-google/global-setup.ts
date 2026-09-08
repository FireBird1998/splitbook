import { MongoClient } from 'mongodb';

/**
 * Start every Google-mode run from an empty `splitbook-google-e2e` database.
 *
 * The approved identity is created by Better Auth during the run; keeping it
 * between runs would mean a stale user row (for example one written by an
 * earlier version) decides whether the sign-in links or is refused. Only this
 * dedicated database is ever dropped.
 */
const GOOGLE_E2E_MONGODB_URI =
  'mongodb://127.0.0.1:27017/splitbook-google-e2e?directConnection=true';

export default async function globalSetup(): Promise<void> {
  const client = new MongoClient(GOOGLE_E2E_MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    await client.db('splitbook-google-e2e').dropDatabase();
  } finally {
    await client.close();
  }
}
