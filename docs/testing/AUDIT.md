# Testing audit

Phase 1 only: what the suite is, what this environment actually ran, and a plan
to make it production-grade. No test code was changed.

The principles below are Matt Pocock's `tdd` skill (seams, vertical slices,
no implementation-coupled or tautological tests). The repo already points at
that skill set; the skill files themselves are not installed. See
[The Matt Pocock skills](#the-matt-pocock-skills).

## The Matt Pocock skills

There is no `tdd` or test-architecture skill checked into this repo. There is
no `.cursor/skills`, `.agents/skills`, or `skills/` directory.

What the repo does contain is the wiring that `/setup-matt-pocock-skills`
writes once per repository:

| Path                           | What it is                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/agents/triage-labels.md` | Maps the five `mattpocock/skills` triage roles onto this tracker. The labels are already the same strings.                                                                                          |
| `docs/agents/issue-tracker.md` | How `/triage` and `/wayfinder` should use `gh` on `FireBird1998/splitbook`.                                                                                                                         |
| `docs/agents/domain.md`        | How `/domain-modeling`, `/grill-with-docs`, and `/improve-codebase-architecture` should read `GLOSSARY.md` and `docs/adr/`.                                                                         |
| `CODING_STANDARDS.md`          | The standards `/code-review` is told to read. Its test rule is already the seam rule: Android through the controller snapshot, web through HTTP, and a fix lands with a test that fails without it. |
| `AGENTS.md`                    | Points agents at those three docs.                                                                                                                                                                  |

The skill that governs test architecture is **`tdd`**, not a separate
"test architecture" skill. Canonical source, `main` of
[mattpocock/skills](https://github.com/mattpocock/skills):

- `skills/engineering/tdd/SKILL.md`
- `skills/engineering/tdd/tests.md`
- `skills/engineering/tdd/mocking.md`
- Depends on `skills/engineering/codebase-design/SKILL.md` for the words
  module, interface, depth, seam, and adapter.

What it prescribes, and what this plan follows:

- A **seam** is the public boundary you observe behaviour at. Tests live
  there. For this repo the seams are already named in `CODING_STANDARDS.md`:
  pure functions in `@splitbook/shared`, HTTP for the web app, the Android
  controller's commands and snapshot.
- Agree the seams before writing tests. Spend the finite budget on critical
  paths (money, balances, settle-up, auth, groups), not on every edge.
- **Red, then green, one vertical slice at a time.** Refactoring is a
  separate review, not part of the loop.
- Do not mock your own modules. Mock at system boundaries (clock, external
  APIs). A real database is preferred to a mocked model.
- Expected values are literals, a worked example, or the spec. An assertion
  that recomputes the result the way the code does is tautological.
- Do not write the whole suite before the implementation (horizontal
  slicing). That rule is for future work. This audit does not add tests.

### Install

The skills need installing into the agent. They do not need committing, and
`/setup-matt-pocock-skills` should not be run again: the three
`docs/agents/` files above are already filled in.

For Cursor, from the repo root:

```bash
npx skills@latest add mattpocock/skills -a cursor
```

When the installer asks which skills to take, include `tdd`,
`codebase-design` (`tdd` reads its interface vocabulary from there), and
`setup-matt-pocock-skills` (already applied here; keep the skill available,
do not re-run it). Add `code-review` if reviewers will use it; `CODING_STANDARDS.md`
is the file it reads.

Update later with `npx skills@latest update`. The editable copies land in the
agent skill directory the installer chooses (typically `.agents/skills` or
`.cursor/skills`). Leave them untracked unless the owner wants them vendored.

A self-updating plugin exists for Claude Code, Codex, Copilot, and Gemini
CLI. Cursor is in the "any other agent" path above, which copies files and
does not auto-update.

## How the suite is built

pnpm workspace. Vitest 4.1.10 everywhere tests run. Playwright 1.62.1 on the
web app only. No Jest test suite (Jest packages appear only as React Native
tooling). No coverage provider is installed. `tools/brand` has its own npm
lockfile and no tests.

| Package                      | Runner                               | Config                             | What `pnpm test` runs                               |
| ---------------------------- | ------------------------------------ | ---------------------------------- | --------------------------------------------------- |
| `@splitbook/shared`          | Vitest, node, UTC unless `TZ` is set | `packages/shared/vitest.config.ts` | `src/**/*.test.ts`                                  |
| `@splitbook/mobile`          | Vitest, node, UTC unless `TZ` is set | `apps/mobile/vitest.config.ts`     | `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.ts` |
| `@splitbook/web`             | Vitest, node, UTC unless `TZ` is set | `apps/web/vitest.config.ts`        | `src/**/*.test.ts` only. A `.tsx` test is ignored.  |
| `@splitbook/swarm`           | Vitest                               | `tools/swarm/vitest.config.ts`     | `src/**/*.test.ts`                                  |
| `@splitbook/landing-figures` | Vitest                               | (package default)                  | `src/**/*.test.ts`                                  |

Web splits unit and integration by filename: `*.integration.test.ts` hits a
real MongoDB, one database per file (`splitbook-test-<file>`), dropped on
teardown. `pnpm test` is unit plus integration. `pnpm test:unit` excludes the
integration files. Integration files that use transactions need a replica
set. `group-cleanup-standalone.integration.test.ts` refuses to run unless
`STANDALONE_TEST_MONGODB_URI` names a standalone server.

Playwright is not part of `pnpm test`. Ten configs under `apps/web/`:

| Config                                       | Collected tests                                                            | When CI runs it                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts` (`pnpm web test:e2e`) | 600 in 26 files, four projects (desktop/mobile × light/dark), `workers: 1` | Nightly / `full-ci` `playwright` job, after a production build                                             |
| `playwright.expense-access.config.ts`        | 246 in 29 files, `workers: 1`                                              | Nightly / `full-ci` `verify` job. Own Next process, own `splitbook-test-access-<uuid>` database            |
| `playwright.google.config.ts`                | 8                                                                          | `playwright` job                                                                                           |
| `playwright.auth-recovery.config.ts`         | 4                                                                          | `verify` job                                                                                               |
| `playwright.design-system.config.ts`         | 20                                                                         | `playwright` job, against a Linux Playwright container                                                     |
| `playwright.pilot.config.ts`                 | 68                                                                         | `playwright` job, same container                                                                           |
| `playwright.production-ui.config.ts`         | 1                                                                          | `playwright` job                                                                                           |
| `playwright.auth-production.config.ts`       | 7                                                                          | Not a step in `.github/workflows/ci.yml`                                                                   |
| `playwright.connect-chatgpt.config.ts`       | 24                                                                         | The spec also sits in the main e2e dir, so this config double-lists those journeys. Not a separate CI step |
| `playwright.mcp-consent.config.ts`           | does not load                                                              | Throws unless `MCP_CONSENT_BASE_URL` is HTTPS                                                              |

Demo e2e shares one `splitbook-demo` database, reseeded in global setup, so
the suite is serial. CI sets Playwright `retries: 1` on that config only.
Expense-access does not retry.

Android also has twelve HTTP verifiers (`apps/mobile/scripts/verify-*.ts`,
`pnpm mobile verify:all`). They drive the real controller against a live
backend. PR checks start that backend with `pnpm swarm up`. They are not
part of `pnpm test`.

### What CI actually gates

From `.github/workflows/ci.yml` and `tools/swarm/README.md`:

- **Every PR and every push to `main`:** format, lint, typecheck, design-system
  policy, `pnpm test:unit` in UTC, then the mobile HTTP verifiers. A
  docs-only PR runs format only. This is the only required check.
- **Nightly, manual, or a PR labelled `full-ci`:** `pnpm test` (unit +
  integration) against a Mongo replica and a standalone, expense-access,
  auth-recovery, the production build, the 600-test browser suite, Google
  sign-in, the component lab, the pilot, production-ui, and the unit tests
  again in `Pacific/Tongatapu`, `Pacific/Kiritimati`, and `Pacific/Pago_Pago`.
- A push to `main` does not run the full suite. The merge is covered that
  night, if the nightly gate does not skip it.

`docs/testing.md` still says there are no collectable component tests and
describes a much smaller suite. `docs/research/codebase-reference.md` §9
still says about 39 files and 250 assertions. The tree today is 350 test
files: 64 shared, 93 mobile, 80 web unit, 42 web integration, 63 Playwright,
6 swarm, 2 landing-figures.

## What was run

Date of the run: 2026-10-16. Dependencies: `pnpm install --frozen-lockfile`
(pnpm 10.23.0). Node for the runs: 22.23.3. The default `node` on this
machine was 22.14.0, which is below the `>=22.18` engine of `@splitbook/swarm`
and `@splitbook/landing-figures`; their tests still passed on 22.23.3.

MongoDB was not in the image and Docker was not available. MongoDB 8.0.34
was installed from the official apt repo and started by hand: a replica set
on `127.0.0.1:27038` (`enableTestCommands=1`) and a standalone on
`127.0.0.1:27017`. CI uses Mongo 7. The integration suite passed on 8.0.34.
That is not a substitute for the Mongo 7 replica CI starts.

Vitest's own config pins `TZ` to UTC when `TZ` is unset, so the unit numbers
below are the UTC run. The three-zone matrix was not repeated.

### Vitest

Wall clock is the time the command took, including startup. File time is the
sum of per-file durations; it is higher where files ran in parallel.

| Package                            | Command                                                                                                           | Files | Tests | Passed | Failed | Skipped | Wall  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----- | ----- | ------ | ------ | ------- | ----- |
| `@splitbook/shared`                | `vitest run`                                                                                                      | 64    | 1,561 | 1,561  | 0      | 0       | 7.0s  |
| `@splitbook/mobile`                | `vitest run`                                                                                                      | 93    | 2,265 | 2,265  | 0      | 0       | 45.1s |
| `@splitbook/swarm`                 | `vitest run`                                                                                                      | 6     | 122   | 122    | 0      | 0       | 14.9s |
| `@splitbook/landing-figures`       | `vitest run`                                                                                                      | 2     | 11    | 11     | 0      | 0       | 0.7s  |
| `@splitbook/web` unit              | `vitest run --exclude 'src/**/*.integration.test.ts'`                                                             | 80    | 959   | 959    | 0      | 0       | 19.3s |
| `@splitbook/web` integration       | `vitest run integration` against the replica, with `STANDALONE_TEST_MONGODB_URI` set                              | 43    | 503   | 503    | 0      | 0       | 45s   |
| `@splitbook/web` standalone re-run | the two files CI runs again with `maxWorkers=1` on the standalone (`ledger-creation-recovery`, `activity-outbox`) | 2     | 16    | 16     | 0      | 0       | 2s    |

The 16 standalone tests are already inside the 503. Unique Vitest tests:
**5,421 passed, 0 failed, 0 skipped.** No Vitest retry is configured, and
nothing failed twice, so the Vitest flake count is 0 on this run.

The integration command did fail once before that. With mongod's soft
`nofile` at 1024 (the `mongodb` user's default; the shell's limit was
524288), Vitest's default parallelism opened enough connections that mongod
logged `Too many open files` and then aborted. Fifteen files reported
`Hook timed out in 30000ms` and two files had real assertion failures that
were the dead connection (`seed-groups`, `ledger` migration:
`MongoNetworkError: connection closed`). Raising mongod's soft limit to
65536 and starting from an empty data directory, the same command passed
503/503 in 45s. Treat the first result as an environment failure, not as
product failures. It is still a suite problem: nothing in
`apps/web/vitest.config.ts` caps workers or the Mongo pool, so a default
mongod makes `pnpm test` go red.

Slowest integration files on the green run: `seed-groups` 20.6s,
`group-cleanup-cli` 10.4s, `seed` 10.2s, `group-cleanup` 9.9s. Slowest unit
files: `apps/mobile/src/app.test.tsx` 8.1s, `app-states.test.tsx` 6.4s,
`tools/swarm/src/live.test.ts` 13.9s. Nothing in Vitest looked pathologically
slow once Mongo stayed up.

### Coverage

Not configured, so CI cannot measure it. `@vitest/coverage-v8@4.1.10` was
installed for one measurement of `@splitbook/shared` and then removed; the
lockfile was not kept.

|            | Hit / total   | Percent |
| ---------- | ------------- | ------- |
| Statements | 3,153 / 3,308 | 95.3%   |
| Functions  | 872 / 912     | 95.6%   |
| Branches   | 2,290 / 2,602 | 88.0%   |

Money modules, statements: `exact-money.ts` 146/154 (94.8%),
`debt-simplifier.ts` 47/48 (97.9%), `split-calculation.ts` 4/4,
`expense-split.ts` 94/95, `payer-remainder.ts` 48/48, `dashboard.ts` 49/50,
`settlement-preview.ts` 29/29, `settlement-authorization.ts` 1/1. The gap
that matters is branches, not statements. Web and mobile were not measured.

### Playwright

Chromium was installed (`playwright install --with-deps chromium`). Docker
was not available, so the design-system and pilot jobs, which talk to a
Playwright container, were not run. The 600-test demo suite was not run: the
expense-access suite alone took 29 minutes on one worker and the Next dev
server restarted itself for memory (`Server is approaching the used memory
threshold, restarting`). A second Next plus four serial browser projects on
the same machine would not have been a fair pass/fail.

**Expense-access** (`EXPENSE_ACCESS_MONGO_PORT=27038`, the replica, matching
CI): 246 tests, **236 passed, 10 failed, 0 skipped, 0 flaky**. Playwright's
flaky count stays 0 because this config does not retry. Duration 1,748s
(29.1 min), one worker.

The ten failures were re-run immediately, same command, only those tests.
The line filter expanded a few into extra projects, so the retry executed 14
tests: **11 passed, 3 failed**, in 270s. Seven of the original failures did
not reproduce. They line up with the memory restart and one
`MongoOperationTimeoutError` during `POST /api/groups` (a 500 where the test
expected 201, an `ECONNRESET` on `POST /api/join`, and several 5s
`toBeVisible` / `toHaveURL` timeouts).

Three failed on both runs:

| Test                                                                    | Assertion                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `group-read-browser.spec.ts` sign-out clears Group cards                | `toHaveURL(/\/dashboard$/)` received `http://127.0.0.1:<port>/`                       |
| `settlement-attempt.spec.ts` sign-out removes every stored payment      | `toHaveURL(<origin>/)` received `<origin>/login?callbackUrl=%2Fgroups%2F…%2Fbalances` |
| `to-review-recovery.spec.ts` Check again after a lost single save reply | `getByRole('button', { name: 'Check again' })` was not visible within 5s              |

This environment cannot separate a product bug from a dev-server restart
that left the app on the wrong route. They are the failures that survived a
quiet retry, so they are the ones to triage first. They are not a license to
raise timeouts.

Not executed, only collected:

| Suite                   | Tests                      | Why it was not run                                                                                                 |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Demo e2e, four projects | 600                        | Serial, needs a reseeded `splitbook-demo` and a long Next session. The machine had just restarted Next for memory. |
| Google sign-in          | 8                          | Same job as demo e2e in CI. Not started.                                                                           |
| Auth recovery           | 4                          | Short, but it boots another isolated app. Not started.                                                             |
| Design system           | 20                         | Needs the Linux Playwright container. No Docker.                                                                   |
| Pilot                   | 68                         | Same container.                                                                                                    |
| Production UI           | 1                          | Runs after the pilot in CI. Not started.                                                                           |
| Auth production config  | 7                          | Not a CI step. Not started.                                                                                        |
| MCP consent             | —                          | Config throws without an HTTPS `MCP_CONSENT_BASE_URL`.                                                             |
| Mobile `verify:*`       | 12 scripts, outside Vitest | Need `pnpm swarm up` and a second Next. Not started, for the same memory reason.                                   |

## Where the critical flows stand

Judged against the seams in `CODING_STANDARDS.md`, not against line coverage.

**Splitting money.** The real implementation is integer minor units in
`packages/shared/src/exact-money.ts`. `calculateSplitAmounts` is a major-unit
wrapper over it. Shared tests passed (1,561) and statement coverage of the
money modules is high. `split-calculation.test.ts` still has six
`toBeCloseTo` assertions on the wrapper. Those pass by being close, which is
the float behaviour the minor-unit module was built to leave behind. Expected
values at this seam should be minor-unit literals. Web and Android both call
the shared module; they do not keep a second copy of the arithmetic. That
part is in good shape.

**Balances.** `balance-integrity.integration.test.ts` hits a real database:
zero-sum, settlements shrinking a debt, per-currency dashboard buckets,
legacy mixed currency, archived trips. That is the right seam.
`balance.service.test.ts` mocks `@/lib/db`, the Expense, Settlement, and
Group models, and `recurring-expense.service`. The `tdd` skill calls that
implementation-coupled: the test breaks when the query changes and the
balance does not. The integration file already covers the behaviour that
matters.

**Settle-up.** Service tests and the expense-access suite both record
settlements (`settlement-attempt.spec.ts`, `ledger-money.spec.ts`,
`ledger-creation-replay.spec.ts`). There is no
`app/api/groups/[id]/settlements/route.integration.test.ts`. The route's
status codes and error envelope are only pinned where a Playwright test
happens to post. One of those Playwright tests (sign-out clears a stored
payment attempt) failed twice.

**Auth.** Unit tests cover the fail-closed mode switch, the allowlist, the
demo-persona plugin, callback URLs, and Better Auth options on the memory
adapter. `migrate-auth.integration.test.ts` runs the real migration. Google
sign-in is eight Playwright tests that never contact Google, and they are
off the PR path. This audit did not run them.

**Groups.** Membership, last admin, invites, and leave have integration
tests at the service, and some at the route. These route files have no
integration test of their own: `groups/route.ts`, `groups/[id]/route.ts`,
`invite`, `invite-link`, `join/[code]`, `members/[userId]`, `tags`,
`drafts`, `user/profile`, `user/to-review`, `invitations/[id]`, and the
recurring collection route (the `[recurringId]` route does have one).
Several are exercised by expense-access or by a service test that calls the
function directly. That is not the HTTP seam.

**Android.** 2,265 controller and UI tests passed. That matches the agreed
seam (commands and snapshot). The outer HTTP verifiers, which PR checks do
run, were not executed here.

## Problems, by severity

1. **Money, balances, settle-up, and auth integration are not on the PR
   gate.** The required check runs unit tests and the mobile verifiers. The
   503 Mongo tests and every Playwright suite wait for nightly or the
   `full-ci` label. A merge to `main` does not run them. For a product that
   will be sold, a wrong balance can ship and sit until the next morning.

2. **`pnpm test` fails when mongod has a default file-descriptor limit.**
   Reproduced on this machine: soft `nofile` 1024, Vitest default
   parallelism, mongod abort, then 30s hook timeouts that look like product
   failures. The green run needed the limit raised to 65536. The Vitest
   config sets a 20s test timeout and a 30s hook timeout and does not limit
   workers or the driver pool.

3. **Three expense-access tests failed twice; seven failed only while Next
   was restarting for memory.** Sign-out landed on `/` or `/login` instead
   of the URL the test names, and the To review "Check again" button never
   appeared. The suite is one worker, 29 minutes, and a single memory
   restart accounts for the seven that then passed. Playwright will not
   record those as flaky, because this config does not retry. The demo
   config retries once in CI, which hides the same class of miss.

4. **Web UI behaviour is only pinned in the nightly browser suite.** Vitest
   collects `src/**/*.test.ts` and the component tests render static markup
   with `renderToStaticMarkup`. They cannot click, type, or submit. The
   interactions live in Playwright, serial, often times four theme
   projects. `docs/testing.md` still says a component test would not be
   collected at all, which is no longer true and will send the next agent
   the wrong way.

5. **There is no coverage gate.** Shared is 95% statements and 88% branches,
   measured once, outside CI. Web and mobile are unknown. A statement
   percentage on `exact-money.ts` will stay green while a branch in the
   remainder rules is uncovered.

6. **Some tests mock the modules under test.** `balance.service.test.ts`
   mocks the models. Many route integration tests mock `@/lib/auth` and
   call the handler, which is closer to the seam but still not a request.
   The skill's rule is to mock the session boundary only when the route
   cannot be driven through a real sign-in. Expense-access already does
   the real sign-in, and it is the suite that is slowest and off the PR
   path.

7. **Split tests still tolerate float drift.** Six `toBeCloseTo` calls in
   `packages/shared/src/split-calculation.test.ts` sit on top of an integer
   implementation. A one-minor-unit regression can pass.

8. **The browser configs will not stay operable.** Ten configs, one shared
   demo database, `workers: 1`, a 55-minute CI job, and two suites that
   need Docker. `mcp-consent` does not even list without an HTTPS URL.
   `connect-chatgpt` is collected twice.

9. **The testing docs describe an older suite.** `docs/testing.md` and
   `docs/research/codebase-reference.md` §9 will mislead anyone adding
   tests. The file counts in this audit are the current ones.

10. **The Android HTTP verifiers are invisible to `pnpm test`.** They are
    the outer seam and they do run in PR checks, but a red verifier is a
    different command from a red unit test, and this audit could not run
    them here. They need a documented, isolated run that does not depend on
    a human remembering `pnpm swarm gate`.

## Plan

Each workstream owns a disjoint set of files so agents can run at the same
time. No stream adds a dependency except WS-C, which is the only one allowed
to edit `pnpm-lock.yaml`. No stream edits `docs/testing/AUDIT.md`. No stream
rewrites a test it does not own. Follow `tdd`: one failing test, one seam,
literal expected values, no mocks of our own modules.

Do these together. None of them need another's output.

### WS-A — Put the money seam on the PR gate

Owns `.github/workflows/ci.yml` only.

PR checks already start a Mongo replica for the mobile verifiers. Run the
existing web integration tests against it (`pnpm --filter @splitbook/web test:integration`,
with `TEST_MONGODB_URI` on that replica and `STANDALONE_TEST_MONGODB_URI` on
the standalone the job already has). Do not add the Playwright suites to
every PR. Do not edit a test. Keep the check's name `PR checks`.

### WS-B — Stop the integration suite from exhausting mongod

Owns `apps/web/vitest.config.ts` and `apps/web/src/lib/test-utils/integration-db.ts` only.

Cap integration file parallelism, or set the test driver's pool size, so a
mongod with soft `nofile` 1024 can finish `pnpm test`. Do not change the
production pool in `mongodb-client.ts`. Do not raise `hookTimeout` to hide
the 30s failures. Prove it by running the integration command against a
mongod whose soft limit is 1024.

### WS-C — Literal money tests and a branch threshold

Owns `packages/shared/package.json`, `pnpm-lock.yaml`, `packages/shared/vitest.config.ts`,
and these test files only: `exact-money.test.ts`, `split-calculation.test.ts`,
`debt-simplifier.test.ts`, `expense-split.test.ts`, `settlement-preview.test.ts`,
`dashboard.test.ts`.

Replace `toBeCloseTo` on split results with minor-unit literals. Add the
missing branch cases the 88% number is pointing at, one assertion at a time,
red then green. Add `@vitest/coverage-v8` and a branch threshold for those
modules only, enforced by this package's `test` script. Do not change
production arithmetic unless a new literal fails; if it does, fix that
function and stop. No other stream may touch the lockfile.

### WS-D1 — HTTP tests for groups and membership

New files only. Do not edit an existing test.

- `apps/web/src/app/api/groups/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/invite/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/invite-link/route.integration.test.ts`
- `apps/web/src/app/api/join/[code]/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/members/[userId]/route.integration.test.ts`
- `apps/web/src/app/api/invitations/[id]/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/tags/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/tags/[tagId]/route.integration.test.ts`

Drive the route over HTTP with a real session, the way expense-access does.
Assert status, error code, and one literal outcome (a member can join, an
outsider cannot). Do not mock the group service.

### WS-D2 — HTTP tests for settle-up, drafts, and profile

New files only. Disjoint from D1.

- `apps/web/src/app/api/groups/[id]/settlements/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/drafts/route.integration.test.ts` and the
  `[draftId]`, `review`, and `save` routes beside it
- `apps/web/src/app/api/user/to-review/route.integration.test.ts`
- `apps/web/src/app/api/user/profile/route.integration.test.ts`
- `apps/web/src/app/api/groups/[id]/recurring/route.integration.test.ts`
  (the collection route; leave the existing `[recurringId]` file alone)

The settlement file should show a partial payment shrinking the balance by a
literal minor-unit amount, a non-participant rejected, and a second post of
the same idempotency key not recording twice. Read the balance back through
the balances route, not through a model query.

### WS-E — Drop the mocked balance service tests

Owns `apps/web/src/lib/services/balance.service.test.ts` and, only if a case
exists there and nowhere else, `apps/web/src/lib/services/balance-integrity.integration.test.ts`.

Delete assertions that mock Mongoose. Keep any case the integration file
does not already prove, moved onto that file, with a literal expected
balance. Do not add a new mock.

### WS-F — Make the demo browser suite pay for itself

Owns `apps/web/playwright.config.ts` and `apps/web/playwright/**` only.

Money journeys (add expense, record payment, demo journeys) run once, not
across all four theme projects. Theme and axe stay on the matrix. Read-only
specs may run with more than one worker only if they do not write
`splitbook-demo`. Do not edit expense-access. Do not weaken an assertion to
make the split work.

### WS-G — Triage the three repeated expense-access failures, then split the suite

Owns `apps/web/playwright-expense-access/**` and `apps/web/playwright.expense-access.config.ts` only.

First, the three tests that failed twice (sign-out in `group-read-browser`,
sign-out in `settlement-attempt`, "Check again" in `to-review-recovery`).
Find out whether the app or the test is wrong. Do not raise the 5s timeout
to make them pass. A dev-server compile is already allowed 30s in the
settlement test; that one still failed.

Then split HTTP specs from browser specs so the HTTP files can run with more
than one worker. Each run already has its own database. Browser specs that
share a page stay at one worker. Do not edit `apps/web/playwright/`.

### WS-H — Correct `docs/testing.md`

Owns `docs/testing.md` only.

Replace the "no component tests" paragraph and the old layer table with the
file counts and CI split in this audit. Link here. Describe the suite as it
is today, not as these workstreams will leave it.

### WS-I — Keep the Android verifiers runnable without a scavenger hunt

Owns `apps/mobile/scripts/verify-*.ts` and `apps/mobile/scripts/verify-all.mjs` only.

Do not rewrite the 2,265 controller tests. Do not edit `.github/workflows/ci.yml`
(that is WS-A) or `tools/swarm`. Make a failing verifier name the command and
the HTTP status or snapshot it observed. Leave `pnpm test` as the Vitest
suite; the verifiers need a live backend and should keep a separate command.

## Out of scope for these streams

- Vendoring the Matt Pocock skills into git. Install them locally with the
  command above.
- Rewriting passing controller tests, seed tests, or the golden JSON
  contract tests (`list-before-310.golden.json`, `insights-before-315.golden.json`).
- Running the 600-test demo suite, the Google suite, the pilot, or the
  mobile verifiers as part of this audit. The numbers above are what was
  actually executed.
- Changing production money code except where WS-C's new literal fails.
