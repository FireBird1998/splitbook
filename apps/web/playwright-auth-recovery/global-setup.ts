import { randomUUID } from 'node:crypto';
import { startIsolatedApp } from '../playwright-expense-access/global-setup';

export default async function globalSetup() {
  const idTokenSecret = randomUUID();
  let testsStarted = false;
  const lateCompilations: string[] = [];
  const cleanup = await startIsolatedApp(
    'google',
    {
      email: 'auth-recovery@splitbook.test',
      idTokenSecret,
    },
    // Build the isolated snapshot once; no request in a test can start compilation.
    true,
    {
      onOutput: (output) => {
        if (testsStarted && /(?:Compiling|Compiled) \//.test(output))
          lateCompilations.push(output.trim());
      },
    },
  );
  process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET = idTokenSecret;
  testsStarted = true;
  return async () => {
    await cleanup();
    if (lateCompilations.length)
      throw new Error(
        `Routes compiled during auth-recovery tests:\n${lateCompilations.join('\n')}`,
      );
  };
}
