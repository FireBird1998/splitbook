import { execFileSync } from 'node:child_process';

/**
 * Reset + reseed the demo database so every Playwright run starts from the
 * known seeded state (three personas, the Goa trip and the demo Groups beside
 * it, seeded balances).
 *
 * The seed runs with recurring Expenses switched on (#289), so the Household's
 * monthly bills are templates whatever the runner's environment or `.env.local`
 * says. The ledger and every balance are the same with the switch off; the app
 * server keeps its own setting.
 *
 * Only ever touches `splitbook-demo` — the database the demo app itself
 * uses. Integration tests use separate `splitbook-test-*` databases.
 */
const DEMO_MONGODB_URI = 'mongodb://127.0.0.1:27017/splitbook-demo?directConnection=true';

export default function globalSetup(): void {
  execFileSync('pnpm', ['run', 'demo:reset'], {
    env: { ...process.env, MONGODB_URI: DEMO_MONGODB_URI, RECURRING_EXPENSES_ENABLED: 'true' },
    stdio: 'inherit',
  });
}
