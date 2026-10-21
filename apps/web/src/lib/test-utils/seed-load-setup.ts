import { MongoClient } from 'mongodb';
import keepNoSnapshotHistoryDuringTheRun from './integration-global-setup';

/** Simulate database contention without saturating the shared host's CPUs (#740). */
export default async function seedLoadSetup() {
  const uri = process.env.TEST_MONGODB_URI!;
  const restoreHistory = await keepNoSnapshotHistoryDuringTheRun();
  const client = new MongoClient(uri, { appName: 'seed-load-controller' });
  try {
    await client.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: 'alwaysOn',
      data: {
        appName: 'splitbook-seed-load',
        failCommands: [
          'find',
          'aggregate',
          'insert',
          'update',
          'delete',
          'findAndModify',
          'commitTransaction',
        ],
        blockConnection: true,
        blockTimeMS: 10,
      },
    });
  } catch (error) {
    await client.close();
    await restoreHistory?.();
    throw error;
  }
  return async () => {
    try {
      await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
      await restoreHistory?.();
    } finally {
      await client.close();
    }
  };
}
