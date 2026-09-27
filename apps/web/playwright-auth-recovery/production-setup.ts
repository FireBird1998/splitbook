import { randomUUID } from 'node:crypto';
import { startIsolatedApp } from '../playwright-expense-access/global-setup';

export default async function globalSetup() {
  const idTokenSecret = randomUUID();
  const cleanupGoogle = await startIsolatedApp(
    'google',
    { email: 'auth-recovery@splitbook.test', idTokenSecret },
    true,
  );
  const googleURL = process.env.EXPENSE_ACCESS_BASE_URL;
  const googleDB = process.env.EXPENSE_ACCESS_TEST_DB;
  try {
    const cleanupDemo = await startIsolatedApp('demo', undefined, true);
    process.env.AUTH_PRODUCTION_DEMO_URL = process.env.EXPENSE_ACCESS_BASE_URL;
    process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET = idTokenSecret;
    process.env.EXPENSE_ACCESS_BASE_URL = googleURL;
    process.env.EXPENSE_ACCESS_TEST_DB = googleDB;
    return async () => {
      try {
        await cleanupDemo();
      } finally {
        await cleanupGoogle();
      }
    };
  } catch (error) {
    await cleanupGoogle();
    throw error;
  }
}
