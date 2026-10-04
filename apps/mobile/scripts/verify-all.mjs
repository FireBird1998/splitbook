/**
 * Runs every `verify:*` script in this package against one fictional backend, the one
 * named by MOBILE_VERIFY_URL (default http://127.0.0.1:4138). Every script runs, even
 * after a failure, and the exit code is nonzero when any of them failed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mobileDirectory = resolve(import.meta.dirname, '..');
const { scripts } = JSON.parse(readFileSync(resolve(mobileDirectory, 'package.json'), 'utf8'));
const verifiers = Object.keys(scripts).filter(
  (name) => name.startsWith('verify:') && name !== 'verify:all',
);

const results = [];
for (const name of verifiers) {
  const started = Date.now();
  const { status, error } = spawnSync('pnpm', ['run', name], {
    cwd: mobileDirectory,
    stdio: 'inherit',
  });
  if (error) console.error(`${name} could not start: ${error.message}`);
  results.push({ name, passed: status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log('');
for (const { name, passed, seconds } of results) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} (${seconds} s)`);
}
const failed = results.filter((result) => !result.passed).length;
console.log(
  failed ? `${failed} of ${results.length} verifiers failed.` : `All ${results.length} passed.`,
);
process.exitCode = failed ? 1 : 0;
