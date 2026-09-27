import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { webApp, isolatedEnv, databaseName, mongoPort } from './environment.mjs';

const environment = isolatedEnv();
const require = createRequire(resolve(webApp, 'package.json'));
require.resolve('tsx');
require.resolve('mongodb');

if (process.argv.includes('--check')) {
  console.log(
    `Seed preflight passed: loopback Mongo port ${mongoPort}, fictional database ${databaseName}`,
  );
} else {
  const child = spawn(
    process.execPath,
    [
      resolve(webApp, 'node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve(webApp, 'scripts/tsconfig.json'),
      resolve(import.meta.dirname, 'seed-fixtures.mjs'),
    ],
    { cwd: webApp, env: environment, stdio: 'inherit' },
  );
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
