import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Run this case against the separate standalone server; false means this is that child. */
export async function runStandaloneCase(file: string, name: string, childFlag: string) {
  if (process.env[childFlag] === 'true') return false;
  const uri = process.env.STANDALONE_TEST_MONGODB_URI;
  if (!uri) throw new Error('Standalone coverage requires STANDALONE_TEST_MONGODB_URI');
  const directory = await mkdtemp(join(tmpdir(), 'splitbook-standalone-'));
  try {
    await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/vitest/vitest.mjs'), 'run', file, '-t', name, '--maxWorkers', '1'],
      {
        cwd: process.cwd(),
        timeout: 15000,
        env: {
          ...process.env,
          TEST_MONGODB_URI: uri,
          [childFlag]: 'true',
          RECORDING_STANDALONE_RESULT: join(directory, 'unused.json'),
        },
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return true;
}
