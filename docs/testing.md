# Testing

What the suite holds, how to run each part and which CI job runs it, as on `main` on
2026-10-17. [docs/testing/AUDIT.md](testing/AUDIT.md) is the audit this guide was rewritten
from, frozen as it found the suite; [docs/testing/SPEC.md](testing/SPEC.md) and spec #468 are
the work that followed it. When a file count below drifts, the commands still hold.

| Layer                   | Where                                                                         | Files         | Runs on                                                           | Command                                                                     | In CI                               |
| ----------------------- | ----------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Shared domain           | `packages/shared/src/**/*.test.ts`                                            | 66            | Vitest, no database                                               | `pnpm --filter @splitbook/shared test`                                      | PR checks, time-zone matrix, verify |
| Web unit                | `apps/web/src/**/*.test.ts`, not integration                                  | 81            | Vitest, no database                                               | `pnpm web test:unit`                                                        | PR checks, time-zone matrix, verify |
| Web integration         | `apps/web/src/**/*.integration.test.ts`                                       | 60            | Vitest against a MongoDB replica set                              | `pnpm web test:integration`                                                 | PR checks, verify                   |
| Android                 | `apps/mobile/src`, `apps/mobile/scripts`                                      | 94            | Vitest and react-test-renderer, no database                       | `pnpm mobile test`                                                          | PR checks, time-zone matrix, verify |
| Android HTTP verifiers  | `apps/mobile/scripts/verify-*.ts`                                             | 11            | a backend of the run's own (`pnpm swarm up`)                      | `pnpm mobile verify:all`                                                    | PR checks                           |
| Tooling                 | `tools/swarm`, `tools/landing-figures`                                        | 6 and 3       | Vitest                                                            | `pnpm --filter @splitbook/swarm test`                                       | PR checks, time-zone matrix, verify |
| Expense access          | `apps/web/playwright-expense-access/`                                         | 28 specs      | Playwright, HTTP and Chromium, an isolated app and database       | `pnpm web test:expense-access`                                              | verify                              |
| Google sign-in recovery | `apps/web/playwright-auth-recovery/`                                          | 1 spec        | Playwright, an isolated app in Google mode                        | `pnpm web exec playwright test --config playwright.auth-recovery.config.ts` | verify                              |
| Browser journeys        | `apps/web/playwright/`                                                        | 26 specs      | Playwright, four theme projects, the seeded `splitbook-demo`      | `pnpm web test:e2e`                                                         | playwright                          |
| Google sign-in journeys | `apps/web/playwright-google/`                                                 | 2 specs       | Playwright, `AUTH_MODE=google`                                    | `pnpm web test:e2e:google`, then `pnpm web test:e2e:google:assistants`      | playwright                          |
| Component lab and pilot | `playwright-design-system/`, `playwright-pilot/`, `playwright-production-ui/` | 1, 4, 1 specs | Playwright; in CI the lab and pilot use a Linux browser container | `pnpm web test:design-system`, `test:pilot`, `test:production-ui`           | playwright                          |

Three Playwright configs are not CI steps: `playwright.auth-production.config.ts` (production
sign-in journeys, run by hand), `playwright.connect-chatgpt.config.ts` (its spec also runs in the
browser journeys) and `playwright.mcp-consent.config.ts`, which stops at load unless
`MCP_CONSENT_BASE_URL` names an HTTPS demo server.

## Running it

- **`pnpm test:unit`** runs every package's unit tests: shared (with its coverage gate), web
  without the integration files, Android and the tooling. No database.
- **`pnpm swarm gate`** before every push. It runs lint, typecheck, the format check, the unit
  tests, the ceilings ratchet and every Android verifier on a backend of its own
  ([tools/swarm](../tools/swarm/README.md#pnpm-swarm-gate)). It never runs the web integration
  suite, which PR checks does, so a branch can pass the gate and fail PR checks: run the
  integration suite yourself when a change touches the database, the routes or money.
- **`pnpm web test:integration`** needs a MongoDB replica set and a standalone server:

  ```sh
  docker run --detach --name splitbook-it-rs --publish 127.0.0.1:27139:27139 \
    mongo:7.0.39 mongod --replSet itTest --bind_ip_all --port 27139 --setParameter enableTestCommands=1
  docker exec splitbook-it-rs mongosh --port 27139 --quiet \
    --eval 'rs.initiate({_id:"itTest",members:[{_id:0,host:"127.0.0.1:27139"}]})'
  docker run --detach --name splitbook-it-sa --publish 127.0.0.1:27140:27140 \
    mongo:7.0.39 mongod --bind_ip_all --port 27140
  TEST_MONGODB_URI='mongodb://127.0.0.1:27139/?directConnection=true' \
    STANDALONE_TEST_MONGODB_URI='mongodb://127.0.0.1:27140/?directConnection=true' \
    pnpm web test:integration
  ```

  Draft, To review and Tag saves use transactions, and the Group-cleanup tests set failpoints,
  so the replica set needs `enableTestCommands`; the tests fail, never skip, without them.
  `group-cleanup-standalone.integration.test.ts` refuses to start without
  `STANDALONE_TEST_MONGODB_URI`. Pick ports nobody else uses.

- **`pnpm test`** runs every package's `test` script: the same as `pnpm test:unit` plus the web
  integration suite, so it needs the same two URIs.

Unit and integration tests are pinned to UTC, the zone CI uses. When `TZ` is unset, the Vitest
configs in `apps/web`, `apps/mobile` and `packages/shared` run every test in UTC, whatever the
machine's zone. Set `TZ` to run another zone, for example `TZ=Pacific/Kiritimati pnpm test:unit`.
Each package's `src/test-time-zone.test.ts` names the zone the run resolved to.

## Shared domain tests and the coverage gate

`packages/shared` holds the money, split, balance, date and To review modules both clients use
(ADR 0002), and its tests assert exact minor-unit literals (#471). Its two scripts differ on
purpose:

- **`test`** is plain Vitest, so one file can run on its own for red and green.
- **`test:unit`**, which CI and `pnpm swarm gate` run, adds `--coverage` over the money modules
  (`exact-money`, `split-calculation`, `debt-simplifier`, `expense-split`, `settlement-preview`
  and `dashboard`). A drop below 98% of their branches fails the run.

## Web unit tests

`*.test.ts` beside the code, with no database: pure helpers, validators, the auth wiring on
Better Auth's memory adapter (the allowlist gate, the proxy's decision table, callback-URL
safety, the test ID-token verifier and its production gate, the demo-persona plugin), the
seed plans, the client fetch layer, and components.

Components are tested as markup: a `.test.ts` file renders them with `renderToStaticMarkup` and
reads the HTML (the landing page, To review's panel, the trip summary, the statement and
others). Vitest collects only `src/**/*.test.ts`, and these tests cannot click, type or submit.
Interactions are pinned in the Playwright suites below. A server page also passes through
React Server Components, which `renderToStaticMarkup` skips: a prop a client component can't
receive (a function `sx`, say) only fails when the page is served.

### The `server-only` tripwire and non-Next runtimes

`src/lib/db.ts` and `src/lib/mongodb-client.ts` open with `import 'server-only'`, which throws
unless the bundler resolves it under the `react-server` export condition. Next.js provides that;
plain Node does not. Anything that loads those modules outside Next therefore needs the package
aliased to the no-op stub in
[`src/lib/test-utils/stubs/server-only.ts`](../apps/web/src/lib/test-utils/stubs/server-only.ts):

- **Vitest**: via `resolve.alias` in [`vitest.config.ts`](../apps/web/vitest.config.ts).
- **`tsx` CLI scripts** (`demo:seed`, `demo:reset`, `migrate:auth`): via a `paths` mapping in
  [`scripts/tsconfig.json`](../apps/web/scripts/tsconfig.json), which the `package.json` scripts
  select with `tsx --tsconfig`.

Never fix a "cannot be imported from a Client Component" error by removing the
`import 'server-only'` line: it is a deliberate control that makes a client-side import of a
database module fail the build instead of leaking credentials. Alias it for the new runtime
instead.

## Web integration tests

`*.integration.test.ts` beside the code, against a real MongoDB through the real service layer,
with no mocked models. Of the 60 files:

- **33 route tests** under `src/app/api` call the exported route handlers with a member signed in
  for real (#472, #473): a demo-persona sign-in through Better Auth's own handler sets the
  session cookie, and the route's `getAuthUser()` checks a session stored in the file's own
  database ([`signed-in-route.ts`](../apps/web/src/lib/test-utils/signed-in-route.ts)). They pin
  status codes, the error envelope and the stored result for Groups, invitations, membership,
  Tags, Expenses, Settlements, Drafts, To review, the profile and recurring Expenses.
- **16 service files** under `src/lib/services`: Groups and leaving them, invitations, Expense
  and Settlement rules with duplicates, date filters and the member breakdown, Drafts and To
  review, balances and ledger integrity, recurring generation and its switch, Tag identity,
  ledger-creation recovery and the Activity outbox.
- **The rest**: the four data migrations, the demo seed and its reset, Group cleanup (with the
  standalone-compatibility file), the MCP connection and the Auth.js to Better Auth migration.

### Database isolation

[`src/lib/test-utils/integration-db.ts`](../apps/web/src/lib/test-utils/integration-db.ts):

1. Every test file gets **its own database**, `splitbook-test-<file key>`, on the server
   `TEST_MONGODB_URI` names (default `mongodb://127.0.0.1:27017/?directConnection=true`); any
   database segment in the URI is replaced.
2. Per-file databases let Vitest run files in parallel without clobbering each other.
3. Each file drops its database on teardown, then forces a checkpoint (`fsync`).
4. A guard refuses any name without the `splitbook-test-` prefix or one that resembles a demo or
   production database, so `splitbook-demo` is never touched.

Each test database is about 35 files mongod keeps open, and a dropped database's files stay open
until a checkpoint passes the drop and the drop leaves the snapshot history window. So for the
run (#470):

- Vitest's global setup ([`integration-global-setup.ts`](../apps/web/src/lib/test-utils/integration-global-setup.ts))
  sets the server's `minSnapshotHistoryWindowInSeconds` to 0 and puts back the value it found
  afterwards. With no history, the checkpoint each teardown forces closes a dropped database's
  files at once, and the suite stays inside mongod's default soft limit (nofile 1024).
- Vitest uses at most four workers, since the open-file count grows with them.
- PR checks starts its test mongods at that default limit, so a change that makes the suite hold
  too many files open fails on the pull request (#484).
- The user in `TEST_MONGODB_URI` needs cluster privileges for `getParameter`, `setParameter` and
  `fsync`: a `readWrite`-only user fails at global setup or in `beforeAll`. A local Docker
  mongod without authentication has them.

## Authenticated expense requests

`pnpm web test:expense-access` runs `playwright.expense-access.config.ts`: 28 specs of real HTTP
requests and Chromium journeys through Better Auth, the route adapters and MongoDB. Each persona
signs in through `POST /api/auth/demo-persona/sign-in` and keeps the session cookie. The suite
covers reads, edits, soft deletion and restoration across disjoint and overlapping Groups, for
outsiders, revoked members with still-valid sessions and anonymous callers; the export, the
statement, insights and the trip summary reads; settlement attempts, a lost create reply
retried once from the form (`retry-ui.spec.ts`) and from Quick add (`quick-add-retry.spec.ts`),
To review's lost-reply recovery, Tags, the profile, stale tabs and account switches. Denied
writes are checked through later authorized requests, not database queries or mocked helpers.

It runs on one worker. Its MongoDB is `127.0.0.1:27017` unless `EXPENSE_ACCESS_MONGO_PORT`
names another loopback port; To review saves and Tag actions need transactions, so give it a
replica set (CI uses verify's on 27038). With `CI` set it serves a production build of the
snapshot, otherwise `next dev`.

Isolation is deliberately stricter than the browser journeys':

- A fresh `splitbook-test-access-<uuid>` database is minted for each run, always on loopback;
  caller-provided MongoDB URIs and app URLs are not used.
- A temporary source snapshot holds only app source, public assets and the build configuration.
  No `.env` file is copied. The child process gets an allowlisted environment with synthetic
  auth settings.
- The suite starts its own Next app on an allocated port and waits for that child to report
  readiness. It never reuses a running app or its `.next` lock.
- Teardown stops the app, drops only the minted database and removes the snapshot. The working
  ledger and the demo database are untouched.
- Tests use the guarded demo personas; no production auth bypass is introduced. Fixture Groups,
  memberships and Expenses are made through requests.

The single-Expense module interface requires `{ actorId, groupId, expenseId }`. The actor comes
from the session; current membership and the Group-scoped lookup are enforced inside the module
before reads or writes. This does not promise transactional protection against revocation
racing an already-authorized write.

`playwright.auth-recovery.config.ts` reuses the same isolated app in Google mode for the sign-in
recovery journeys (an invalid session cookie, a failed first Google request, a valid database
session at `/login`). Its spec opens MongoDB on `127.0.0.1:27017` itself, so run it with the
app's database there too.

## Browser journeys (Playwright)

Configured in [`playwright.config.ts`](../apps/web/playwright.config.ts); specs and helpers live
in [`playwright/`](../apps/web/playwright/).

- The app runs on **port 3100** with `AUTH_MODE=demo` and persistent Drafts on (`next start`
  with `CI` set, `next dev` otherwise). Global setup resets and reseeds `splitbook-demo` on
  `127.0.0.1:27017` (`pnpm web demo:reset`, with recurring Expenses on for the seed). Drafts need
  transactions, so that MongoDB must be a replica set; CI starts one.
- Four projects, **desktop-light, desktop-dark, mobile-light and mobile-dark** (1280×800 and
  390×844, `prefers-color-scheme` emulated), run the same specs. **Money journeys**, the tests
  tagged `@money` (`MONEY_JOURNEY` in `playwright/fixtures.ts`), record an Expense or a payment
  and run in desktop-light only (#475); theme, axe and layout checks run in all four and write
  nothing.
- Journeys share one database, so the suite runs with `workers: 1`. A test runs after whatever
  earlier tests wrote, so assertions on mutable balances compare with the read they come from
  rather than assume a figure.
- Waits on To review's 30 s refresh run on Playwright's clock (`page.clock.runFor`) instead of
  real time (#483).
- Review screenshots go to `apps/web/playwright/artifacts/<project>/` (gitignored, uploaded by
  CI).

What each spec covers:

- **Journeys** (`demo-journeys.spec.ts`, serial): Alex enters and inspects her seeded balance
  (exact amounts asserted once, on desktop-light, before any change), follows Needs you's Record
  to the payment's Group Balances, creates a trip, adds and edits an Expense; Sam records a
  payment, the debt shrinking by exactly that; Priya checks her untouched balance and the
  invitation in Needs you. Each persona's Home is checked against the balances read (#306).
- **Shell** (`shell.spec.ts`): the desktop sidebar, the phone drawer, the phone top bar at
  320–430 px with and without the demo badge, the theme switch and Sign out; axe on each.
- **Theme and axe matrix** (`theme-a11y.spec.ts`): persona entry, Home and the trip workspace in
  every project, the theme toggle and its persistence; axe fails the test on critical findings.
- **Home** (`home-groups.spec.ts`, `spending-chart.spec.ts`, `latest-changes.spec.ts`): "Where it
  went" and the Groups table (#308), "Your share of spending" with its Table view (#307), and
  latest changes (#309), each compared with the read it comes from.
- **Group page** (`group-page.spec.ts`, read-only): the header, the tabs as links with their own
  addresses through Back, Forward and reload, the old `?tab=` and `?action=add-expense` links,
  the Members roster, and axe on every tab.
- **Expenses tab** (`expense-table.spec.ts`, read-only, #310): filters, sort and search kept in
  the address, "Involves me", the table on computers and cards on phones, the Household Month
  bar, a failed load with Try again, axe and review screenshots.
- **Expense side panel** (`expense-panel.spec.ts`, #311): the panel beside the table, `?expense=`
  through reload, Back and a shared link, and Edit, Duplicate and Delete with Undo from it.
- **Add expense** (`add-expense.spec.ts`, #304): the top bar's button on each screen and its
  Group chooser with axe, the form on every tab of a Group, the old `?action=add-expense` link
  and the no-Groups state; saving from Home and from inside a Group are money journeys.
- **Quick add** (`quick-add.spec.ts`, #320): a line read into chips and added with Enter, the Tag
  a member must pick when none fits, too many decimal places refused, "More options" opening the
  form prefilled; axe on each state. Writes go to a Household the test makes for Alex.
- **Record payment** (`record-payment.spec.ts`, #312): a suggested payment filled into the form,
  the explicit tick for a payment nobody suggested or one larger than suggested, pairs the
  member isn't in refused by page and server, and the Balances tab's layout, keyboard order and
  axe; recording is a money journey.
- **Everyone** (`everyone-chart.spec.ts`, #313): each member's all-time net as a diverging bar,
  with its tooltip and Table view, compared with the Balances read.
- **Insights** (`group-insights.spec.ts`, `group-insights-detail.spec.ts`, read-only, #314,
  #315): Month navigation and the range through reload, the stat cards, columns, average line
  and table, By Tag and Who paid, all checked against the insights read for the browser's zone.
- **Trip summary** (`trip-summary.spec.ts`, read-only, #316): the six-day Trip's figures, day
  columns, tooltip, Table view and wrap-up, and the Expenses list under trip-day headings.
- **Export** (`export.spec.ts`, `export-backup-statement.spec.ts`, #317 to #319): CSV and zip
  downloads read back, the JSON backup parsed by `backupSchema`, the printable statement, a
  Trip's Share wrap-up and the 403 page for a Group Priya can't open.
- **Search** (`search.spec.ts`) and **keyboard shortcuts** (`shortcuts.spec.ts`, #322): the
  search dialog and ⌘K, results and jumps, and the J, K, N, / and E shortcuts with their Settings
  switch, never while typing or with a dialog open.
- **To review** (`to-review.spec.ts`, `to-review-page.spec.ts`, `to-review-quick-fixes.spec.ts`,
  #403, #439): the Home card and Group banner; the page's list and side panel, fixes and edits
  kept, duplicates, Save N ready with mixed outcomes, conflicts with another device, the
  one-at-a-time run, focus and axe at 130% text; quick-fix chips, "You for all" with Undo, row
  Save, Delete and the keyboard.
- **Finish later** (`finish-later.spec.ts`, #407): a member's half-done Expense kept in To review,
  the close prompt, the 100-item limit, a failed Finish later keeping everything, and an
  assistant's provenance in the list, panel and Activity.
- **Assistants** (`connect-chatgpt.spec.ts`, `mcp-consent.spec.ts`): the public ChatGPT guide,
  its authorization states and account switches; the consent screen's optional preparation
  permission, which runs only under its own config.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs one fast job on each pull request
and each push to `main`, and the full suite nightly, by hand or on a pull request labelled
`full-ci` (#277). [tools/swarm](../tools/swarm/README.md#in-ci) says how to ask for the full
suite on a pull request and who hears about a failure. Times are from runs on 2026-10-17, on
GitHub's 4-core public runners.

- **PR checks** (`pr-checks`, about 8 minutes): every pull request, every push to `main` or
  `pilot/tanstack-reads`, and with the full suite. The one check branch protection requires.
  Install, format check, lint, typecheck, the design-system style policy and `pnpm test:unit` in
  UTC; then a `mongo:7.0.39` replica set (27039, test commands on) and a standalone (27040) for
  the web integration suite (#469), both at Linux's default file limit (nofile 1024, #484); then a production backend from `pnpm swarm up` on that
  replica set for every Android verifier (`TZ=Asia/Kolkata`); last, on a pull request, the
  ceilings ratchet. A pull request that changes only Markdown, `docs/` or `.claude/` files runs
  the format check alone.

The full suite never runs on a push to `main`, so a merge reaches it that night; a nightly run is
skipped when `main`'s commit already passed it.

- **verify** (about 11 minutes): install, lint, typecheck (before any step starts Next, #490),
  the design-system style policy, a replica set (27038, test commands on), `pnpm test` (every
  package's unit tests, and the web integration suite on the replica set with the job's
  standalone `mongo:7` service on 27017), the two standalone recovery files again with one
  worker, the Group-cleanup HTTP check against a backend on the replica set, Chromium, the
  expense-access suite on the replica set, the Google sign-in recovery suite, and the build. On a failure it uploads the Playwright
  output and the backend log.
- **playwright** (about 30 minutes, 23 of them the browser journeys): install, Chromium, a
  replica set on 27017 for the demo database, a build with persistent Drafts on, `pnpm web
test:e2e` (`next start` on 3100), then a default build for `pnpm web test:e2e:google` and
  `pnpm web test:e2e:google:assistants` (#450), the
  component lab and the pilot's behaviour, accessibility and visual comparisons (both in a Linux
  Playwright browser container, so screenshots match their baselines), and the production lab
  exclusion. It uploads the report and the review screenshots.
- **unit-time-zones** (about 2 minutes each): `pnpm test:unit` with `TZ` set, as **Unit tests
  (Pacific/Tongatapu)** (UTC+13), **Unit tests (Pacific/Kiritimati)** (UTC+14) and **Unit tests
  (Pacific/Pago_Pago)** (UTC−11), zones without daylight saving time. A failing job names its
  zone.

**Landing figures** (`verify-figures`, `.github/workflows/landing-figures.yml`) runs on pull
requests and pushes to `main` that touch `tools/landing-figures`, its generated output and stills,
the shared money modules its story uses or the lockfile. It runs
`pnpm --filter @splitbook/landing-figures check`
([tools/landing-figures](../tools/landing-figures/README.md)): stale output or a stale still, the
story, the vendored kit, and the audit, line ends and console of every figure page in headless
Chrome. No database.

The Playwright web servers run a **production** build in CI, so their env sets
`ALLOW_DEMO_AUTH=true` (demo auth fails closed in production), `AUTH_RATE_LIMIT_ENABLED=false`
(Better Auth rate-limits production builds per client IP, and behind `next start` on loopback
every request would share one bucket) and, for the Google suite, `ALLOW_TEST_ID_TOKEN=true` (the
test ID-token verifier is refused in production without it).

## Coverage shape

Where the safety net is, and where it is thin:

- **Money is pinned at three seams.** The shared modules assert exact minor units, with a branch
  gate on the money modules; the integration suite checks balances, splits and Settlements
  against a real database on every pull request; the route tests check what each money route
  answers and stores, with a real session.
- **Access is pinned through requests.** The route tests and the expense-access suite cover
  route translation, validation and access enforcement end to end. That is not a codebase-wide
  authorization audit: a route without its own tests does not inherit these guarantees.
- **Interactions live only in Playwright.** Component tests read rendered markup and cannot
  click or type, so a form's behaviour is pinned by the browser journeys, which run in the full
  suite, not on every pull request.
- **Coverage is measured only for the shared money modules.** No other package has a coverage
  report or gate.
- `playwright.google.config.ts` uses an isolated `splitbook-google-e2e` database. It intercepts
  the redirect to Google and asserts its parameters, then proves the approved and denied outcomes
  through Better Auth's ID-token sign-in endpoint with locally signed tokens
  (`AUTH_TEST_ID_TOKEN_SECRET`). Google is never contacted, and only the approved test identity
  is stored. Assistants are off there: `playwright.google-assistants.config.ts` runs the
  same app on 3102 with them live and preparing items (`MCP_ENABLED`,
  `PERSISTENT_DRAFTS_ENABLED`), for the landing page's Connected assistants section and Fig 2,
  as the Connect ChatGPT suite does. Next allows one dev server per folder, so run the two one
  after the other.
