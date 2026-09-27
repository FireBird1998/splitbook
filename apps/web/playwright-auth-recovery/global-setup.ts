import { randomUUID } from 'node:crypto';
import { startIsolatedApp } from '../playwright-expense-access/global-setup';

export default async function globalSetup() {
  const idTokenSecret = randomUUID();
  const cleanup = await startIsolatedApp('google', {
    email: 'auth-recovery@splitbook.test',
    idTokenSecret,
  });
  process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET = idTokenSecret;
  return cleanup;
}
