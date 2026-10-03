/**
 * Runs every `verify:*` script in this package against one fictional backend, the one
 * named by MOBILE_VERIFY_URL (default http://127.0.0.1:4138). Every script runs, even
 * after a failure, and the exit code is nonzero when any of them failed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mobile = resolve(import.meta.dirname, '..');
const { scripts } = JSON.parse(readFileSync(resolve(mobile, 'package.json'), 'utf8'));
const verifiers = Object.keys(scripts).filter(
  (name) => name.startsWith('verify:') && name !== 'verify:all',
);

const results = [];
for (const name of verifiers) {
  console.log(`\n> ${name}`);
  const started = Date.now();
  const { status } = spawnSync(scripts[name], { cwd: mobile, shell: true, stdio: 'inherit' });
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
