import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { webApp, isolatedEnv, origin, databaseName } from './environment.mjs';
import { withIsolatedDatabase } from './database.mjs';

async function main() {
  const environment = isolatedEnv();
  // Starting never claims an existing database: run seed first to establish ownership.
  await withIsolatedDatabase(async () => undefined);
  console.log(`Starting fictional native backend at ${origin}; database=${databaseName}`);
  const child = spawn(
    process.execPath,
    [
      resolve(webApp, 'node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '4138',
    ],
    { cwd: webApp, env: environment, stdio: 'inherit' },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
