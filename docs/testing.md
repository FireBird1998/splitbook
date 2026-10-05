# Testing

Four layers of tests, all wired into CI (`.github/workflows/ci.yml`).

| Layer            | Runner          | Database                            | Command                        |
| ---------------- | --------------- | ----------------------------------- | ------------------------------ |
| Unit             | Vitest          | none (mocked models / pure helpers) | `pnpm test:unit`               |
| Integration      | Vitest          | real MongoDB, isolated per file     | `pnpm test:integration`        |
| Expense requests | Playwright HTTP | real MongoDB, unique per run        | `pnpm web test:expense-access` |
| Browser          | Playwright      | seeded `splitbook-demo`             | `pnpm web test:e2e`            |

`pnpm test` runs unit + integration together and requires MongoDB running
locally (the `split-mongo` Docker container works).

Unit and integration tests are pinned to UTC, the zone CI uses. When `TZ` is
unset, the Vitest configs in `apps/web`, `apps/mobile` and `packages/shared` run
every test in UTC, whatever the machine's zone. Set `TZ` to run another zone,
for example `TZ=Pacific/Kiritimati pnpm test:unit`. Each package's
`src/test-time-zone.test.ts` names the zone the run resolved to.

CI runs the unit tests in four zones. **PR checks** runs them in UTC on every
pull request, and **verify** runs them in UTC with the integration tests. In the
full suite, a time-zone matrix (`unit-time-zones`) runs `pnpm test:unit` again,
one job per zone, in three zones that observe no daylight saving time:

- **Unit tests (Pacific/Tongatapu)**: UTC+13
- **Unit tests (Pacific/Kiritimati)**: UTC+14
- **Unit tests (Pacific/Pago_Pago)**: UTC−11

A failing job names its zone.

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
- **Better Auth wiring** (`lib/auth/*`) — the allowlist gate, the proxy
  decision table (401 JSON, `callbackUrl` redirects), callback-URL safety,
  the test ID-token verifier and its production gate, and the instance
  options run on Better Auth's memory adapter: session policy, rate-limit
  storage, plugin registration, and the Google ID-token path (approved,
  denied, re-linked to an existing user, allowlist re-checked on sign-in).
- **Demo personas** (`lib/demo-personas.ts`, `lib/auth/demo-persona-plugin.ts`) —
  lookup normalisation, and the plugin end to end on the memory adapter:
  absent outside demo mode, unknown/unseeded personas, session cookie.
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
- `services/expense-date-filter.integration.test.ts` — inclusive `dateTo`
  boundary, so an expense late on the final day of a range is not dropped.
- `services/expense-member-breakdown.integration.test.ts` — the opt-in
  `summary.byMember` rows; monthly nets sum to zero.
- `services/recurring-expense.integration.test.ts` — due-period materialization,
  pause/resume, problem-state skipping, and that two concurrent generations
  produce exactly one expense. Note this suite forces `Expense.createIndexes()`
  in setup; production relies on Mongoose `autoIndex` instead.
- `services/balance-integrity.integration.test.ts` — zero-sum balances, debt
  reduction/clearing via settlements, per-currency dashboard buckets, legacy
  mixed-currency flagging, archived-trip exclusion.
- `services/invitation.service.integration.test.ts` — invitation ownership
  (only the invited email may accept/decline), expiry, duplicates.
- `demo/seed.integration.test.ts` — end-to-end seed idempotency, reset, and
  the exact persona balances the private-beta UI promises.
- `auth/migrate-auth.integration.test.ts` — the Auth.js → Better Auth data
  migration (`pnpm web migrate:auth`): forward run, idempotent re-run, dry
  run, a database without the legacy index, and `--revert`.

### Database isolation strategy

[`src/lib/test-utils/integration-db.ts`](../apps/web/src/lib/test-utils/integration-db.ts):

1. Every test file derives **its own database** named
   `splitbook-test-<file-key>` from `TEST_MONGODB_URI` (default
   `mongodb://127.0.0.1:27017/?directConnection=true`); any database segment
   in the URI is replaced.
2. Per-file databases let Vitest run files in parallel without clobbering.
3. Each file drops its database on teardown, so nothing accumulates locally.
4. A guard hard-fails if the resolved name does not start with
   `splitbook-test-` or resembles a demo/production database — the demo
   database (`splitbook-demo`) is never touched by integration tests.

### The `server-only` tripwire and non-Next runtimes

`src/lib/db.ts` and `src/lib/mongodb-client.ts` open with `import 'server-only'`,
which throws unless the bundler resolves it under the `react-server` export
condition. Next.js provides that; plain Node does not. Anything that loads those
modules outside Next therefore needs the package aliased to the no-op stub in
[`src/lib/test-utils/stubs/server-only.ts`](../apps/web/src/lib/test-utils/stubs/server-only.ts):

- **Vitest** — via `resolve.alias` in [`vitest.config.ts`](../apps/web/vitest.config.ts).
- **`tsx` CLI scripts** (`demo:seed`, `demo:reset`, `migrate:auth`) — via a `paths` mapping in
  [`scripts/tsconfig.json`](../apps/web/scripts/tsconfig.json), which the `package.json`
  scripts select with `tsx --tsconfig`.

Never fix a "cannot be imported from a Client Component" error by removing the
`import 'server-only'` line — it is a deliberate control that makes a client-side
import of a DB module fail the build instead of leaking credentials. Alias it for
the new runtime instead.

## Authenticated expense requests

Run `pnpm web test:expense-access` with MongoDB listening on `127.0.0.1:27017`.
No browser installation or Google credentials are needed. To run one slice,
append `read.spec.ts`, `edit-restore.spec.ts`, or `delete.spec.ts`.

The suite exercises actual HTTP requests through Better Auth, the route
adapter, the expense module, and MongoDB. Each persona context signs in
through `POST /api/auth/demo-persona/sign-in` and keeps the session cookie.
It verifies reads, edits, soft deletion and restoration for disjoint and
overlapping Groups, outsiders, revoked members with still-valid sessions, and
anonymous callers. Both manual Expenses and
Expenses generated through the recurring-template request are covered.
Authorized non-admin/non-creator controls preserve population, history,
activity attribution, validation, archived Tags and repeat deletion.
Denied writes are checked through subsequent authorized Expense/history and
both Groups' activity requests, not database queries or mocked helpers.

Isolation is deliberately stricter than the older browser suites:

- A fresh `splitbook-test-access-<uuid>` database is minted for each run,
  always on loopback; caller-provided MongoDB URIs and app URLs are not used.
- A temporary source snapshot includes only app source, public assets and
  the required build configuration. No `.env` files are copied. The child
  process receives an allowlisted environment with synthetic auth settings.
- The suite starts its own Next app on an allocated port and waits for that
  child to report readiness. It never reuses a running app or its `.next` lock.
- Teardown stops the owned app, drops only the minted test database and removes
  the temporary snapshot. The working ledger and persistent demo are untouched.
- Tests use the existing guarded demo personas; no production auth bypass is
  introduced. Fixture Groups, memberships and Expenses are created via requests.

The single-expense module interface requires `{ actorId, groupId, expenseId }`.
The actor comes from the session; current membership and group-scoped lookup
are enforced inside the module before reads or writes. This does not promise
transactional protection against revocation racing an already-authorized write.

## Browser journeys (Playwright)

Configured in [`playwright.config.ts`](../apps/web/playwright.config.ts); specs and
helpers live in [`playwright/`](../apps/web/playwright/).

- The app runs on **port 3100** with `AUTH_MODE=demo`; global setup resets
  and reseeds the `splitbook-demo` database (`pnpm web demo:reset`) so every run
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
- Review screenshots are saved to `apps/web/playwright/artifacts/<project>/`
  (gitignored, uploaded as CI artifacts).
- Journeys share one demo database, so the suite runs with `workers: 1` and
  assertions on mutable balances are relative to what the journey observed.

## CI

Run `pnpm swarm gate` before every push: it is the local CI. GitHub Actions
then runs one fast job on each pull request and the full suite on `main`
(#277). [tools/swarm](../tools/swarm/README.md#in-ci) says what runs where, how
to ask for the full suite on a pull request, and who hears about a failure.

- **PR checks** (`pr-checks`) — every pull request, and with the full suite.
  The one check branch protection requires. Install, format check, lint,
  typecheck, design-system style policy, `pnpm test:unit` in UTC, then every
  mobile HTTP verifier against a production backend that `pnpm swarm up` starts
  on the job's `mongo:7` service. A docs-only pull request runs the format check
  alone.

The full suite runs on each push to `main`, nightly, on a manual run, and on a
pull request labelled `full-ci`. **verify** and **playwright** each have a
`mongo:7` service container:

- **verify** — install, lint, `pnpm test` (unit + integration against the
  service MongoDB), typecheck, the authenticated expense-access and Google
  sign-in recovery suites, build.
- **playwright** — install, Chromium, build, `pnpm web test:e2e` (webServer runs
  `next start` on 3100), then `pnpm web test:e2e:google`, the component lab and
  the pilot's visual comparisons, and uploads the report and review screenshots.
- **unit-time-zones** — a matrix that installs and runs `pnpm test:unit` with
  `TZ` set, as **Unit tests (Pacific/Tongatapu)**,
  **Unit tests (Pacific/Kiritimati)** and **Unit tests (Pacific/Pago_Pago)**.
  No database.

Because the Playwright webServer runs a **production** build, its env must set
`ALLOW_DEMO_AUTH=true` (demo auth fails closed in production),
`AUTH_RATE_LIMIT_ENABLED=false` (Better Auth rate-limits production builds per
client IP, and behind `next start` on loopback every request would share one
bucket), and for the Google suite `ALLOW_TEST_ID_TOKEN=true` (the test
ID-token verifier is refused in production without it).

## Coverage shape

Worth knowing where the safety net is and is not:

- **Strong** on pure logic (split maths, debt simplification, currency bucketing,
  date bounds, auth-mode guards) and on service-level invariants exercised
  through a real database.
- **Request coverage for single-expense access.** The authenticated expense
  suite covers route translation, validation and access enforcement end to end.
  It is not a codebase-wide authorization audit; other routes do not inherit
  these guarantees merely because this suite passes.
- **No component tests are collectable at all** — `vitest.config.ts` includes
  only `src/**/*.test.ts`, so a `.tsx` test would be ignored. That matters
  because split-total validation, month-range parsing and the recurring
  problem-state heuristic currently live only in components.
- `playwright.google.config.ts` uses an isolated `splitbook-google-e2e`
  database. It intercepts the redirect to Google and asserts its parameters,
  then proves the approved and denied outcomes through Better Auth's ID-token
  sign-in endpoint with locally signed tokens (`AUTH_TEST_ID_TOKEN_SECRET`);
  Google is never contacted and only the approved test identity is persisted.
