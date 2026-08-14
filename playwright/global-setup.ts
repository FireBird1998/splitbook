import { execFileSync } from 'node:child_process';

/**
 * Reset + reseed the demo database so every Playwright run starts from the
 * known seeded state (three personas, one Goa trip, seeded balances).
 *
 * Only ever touches `splitwise-demo` — the database the demo app itself
 * uses. Integration tests use separate `splitwise-test-*` databases.
 */
const DEMO_MONGODB_URI = 'mongodb://127.0.0.1:27017/splitwise-demo?directConnection=true';

export default function globalSetup(): void {
  execFileSync('pnpm', ['run', 'demo:reset'], {
    env: { ...process.env, MONGODB_URI: DEMO_MONGODB_URI },
    stdio: 'inherit',
    // On Windows `pnpm` resolves to a .cmd shim, which execFileSync cannot
    // spawn directly.
    shell: process.platform === 'win32',
  });
}
