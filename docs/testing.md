# Testing

Three layers of tests, all wired into CI (`.github/workflows/ci.yml`).

| Layer | Runner | Database | Command |
| --- | --- | --- | --- |
| Unit | Vitest | none (mocked models / pure helpers) | `pnpm test:unit` |
| Integration | Vitest | real MongoDB, isolated per file | `pnpm test:integration` |
| Browser | Playwright | seeded `splitwise-demo` | `pnpm test:e2e` |

`pnpm test` runs unit + integration together and requires MongoDB running
locally (the `split-mongo` Docker container works).

---

## Unit tests

Live next to the code as `*.test.ts`. Cover the parts that must stay correct
without I/O:

- **Split calculations** (`services/split-calculation.ts`) — equal/shares/
  percentage rounding, penny remainders, passthrough for unequal/exact.
- **Debt math** (`utils/debt-simplifier.ts`) — zero-sum invariants, partial /
  over-settlement, minimal transfers.
- **Dashboard buckets** (`utils/dashboard.ts`, `services/balance.service.ts`
  with mocked models) — currencies never combine into one number.
- **Auth-mode guards** (`lib/auth-mode.ts`) — fail-closed in production,
  exact case-sensitive env parsing.
- **Demo personas** (`lib/demo-personas.ts`, `lib/demo-credentials.ts`) —
  allowlist, lookup normalisation, authorize() guard rails.
- **Seed plan invariants** (`demo/seed-plan.ts`) — idempotency decision,
  members/tags/currency consistency of the seeded trip.
- **Settlement authorization** (`utils/settlement-authorization.ts`) — only
  the payer or recipient may record a settlement.

## Integration tests

Live next to the code as `*.integration.test.ts` and hit a **real MongoDB**
through the actual service layer (no mocked models):

- `services/group.service.integration.test.ts` — membership enforcement,
  admin boundaries, last-admin protection, invite codes.
- `services/expense-settlement.integration.test.ts` — participant/tag/
  currency validation, edit history, soft delete + restore, duplicate
  detection, settlement authorization boundaries.
- `services/balance-integrity.integration.test.ts` — zero-sum balances, debt
  reduction/clearing via settlements, per-currency dashboard buckets, legacy
  mixed-currency flagging, archived-trip exclusion.
- `services/invitation.service.integration.test.ts` — invitation ownership
  (only the invited email may accept/decline), expiry, duplicates.
- `demo/seed.integration.test.ts` — end-to-end seed idempotency, reset, and
  the exact persona balances the private-beta UI promises.

### Database isolation strategy

[`src/lib/test-utils/integration-db.ts`](../src/lib/test-utils/integration-db.ts):

1. Every test file derives **its own database** named
   `splitwise-test-<file-key>` from `TEST_MONGODB_URI` (default
   `mongodb://127.0.0.1:27017/?directConnection=true`); any database segment
   in the URI is replaced.
2. Per-file databases let Vitest run files in parallel without clobbering.
3. Each file drops its database on teardown, so nothing accumulates locally.
4. A guard hard-fails if the resolved name does not start with
   `splitwise-test-` or resembles a demo/production database — the demo
   database (`splitwise-demo`) is never touched by integration tests.

## Browser journeys (Playwright)

Configured in [`playwright.config.ts`](../playwright.config.ts); specs and
helpers live in [`playwright/`](../playwright/).

- The app runs on **port 3100** with `AUTH_MODE=demo`; global setup resets
  and reseeds the `splitwise-demo` database (`pnpm demo:reset`) so every run
  starts from the known seeded state.
- **Journeys** (`demo-journeys.spec.ts`, serial): Alex enters and inspects
  her seeded balance (exact amounts asserted once, on desktop-light, before
  any mutation), creates a trip, adds and edits an expense; Sam switches in
  and records a settlement, verified by the debt shrinking exactly; Priya
  verifies her untouched seeded balance.
- **Theme + a11y matrix** (`theme-a11y.spec.ts`): persona entry, dashboard,
  and trip workspace at **desktop 1280×800** and **mobile 390×844**, each in
  **light and dark** (driven by `prefers-color-scheme` emulation), plus the
  navbar theme toggle with persistence. axe-core fails the test on critical
  violations; the full report attaches to the test.
- Review screenshots are saved to `playwright/artifacts/<project>/`
  (gitignored, uploaded as CI artifacts).
- Journeys share one demo database, so the suite runs with `workers: 1` and
  assertions on mutable balances are relative to what the journey observed.

## CI

Two jobs, each with a `mongo:7` service container:

- **verify** — install, lint, `pnpm test` (unit + integration against the
  service MongoDB), typecheck, build.
- **playwright** — install, Chromium, build, `pnpm test:e2e` (webServer runs
  `next start` on 3100), uploads the report and review screenshots.
