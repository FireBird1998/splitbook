# SplitWise — Source-Derived Codebase Reference

**Date:** 2026-08-16
**Scope:** The whole application in this worktree — build surface, request lifecycle, Mongoose domain model, services and business logic, recurring-expense generation (v4 phase 3), auth, theming/UI, SWR data fetching, the three test layers, and currency handling. Written so a reader can predict what the code does without opening it.
**Sources:** **The source code is the primary source** — every behavioural claim below is cited as `path:line` (repo-relative) and was read directly. The repo's own prose docs (`docs/architecture.md`, `docs/api.md`, `docs/database.md`, `docs/auth.md`, `docs/ui.md`, `docs/testing.md`, `docs/features/*`, `docs/pages/*`, `docs/v2|v3|v4/*`) were treated as _claims to verify_, not as fact; each checkable claim was tested against the source and §11 records every confirmed mismatch. Third-party framework behaviour is cited to first-party documentation only (nextjs.org, authjs.dev + the `next-auth` package source, mongodb.com/docs, mongoosejs.com, mui.com, swr.vercel.app). **Nothing was executed.** `node_modules` is not installed in this worktree, so no build, test, lint, typecheck or app run was performed; every statement is static analysis of the checked-out tree at `29fcf2e`.

---

## TL;DR

- **The architecture is a clean three-layer stack with one deliberate violation.** Route handlers do `auth → membership → Zod → service` (`src/app/api/groups/[id]/expenses/route.ts:25-38`), services own all DB access and all invariants (`src/lib/services/expense.service.ts:39-41`), and pure maths lives in dedicated modules (`src/lib/services/split-calculation.ts`, `src/lib/utils/debt-simplifier.ts`). The violation: two **GET** handlers perform writes, materializing recurring expenses on read (`src/app/api/groups/[id]/expenses/route.ts:62`, `src/app/api/groups/[id]/route.ts:33`).
- **Balances are recomputed from scratch on every request** — there is no stored balance. `BalanceService.getGroupBalances` loads every non-deleted expense and every settlement for the group and folds them into a map (`src/lib/services/balance.service.ts:17-47`, `src/lib/utils/debt-simplifier.ts:73-114`), then greedily matches debtors to creditors (`src/lib/utils/debt-simplifier.ts:30-68`).
- **Money is JavaScript `number` (float) everywhere** — schema (`src/lib/models/Expense.ts:86`), splits, balances. Four different rounding helpers exist with different semantics (`src/lib/utils/debt-simplifier.ts:15-17`, `src/lib/services/expense-summary.ts:42-44`, `src/lib/utils/dashboard.ts:3-6`, `src/lib/services/split-calculation.ts:29-30`), and `equal` splits deliberately hand the remainder to participant index 0 (`src/lib/services/split-calculation.ts:34`).
- **The server never checks that split amounts sum to the expense total.** `unequal`/`exact` amounts and multi-payer amounts pass straight through (`src/lib/services/split-calculation.ts:56`); the only sum check is client-side (`src/components/expenses/ExpenseFormDialog.tsx:295-318`). A hand-crafted POST can create a group whose balances do not sum to zero.
- **Expense-by-id routes are not scoped to the group in the URL.** The route checks membership of `params.id` (`src/app/api/groups/[id]/expenses/[expenseId]/route.ts:86-87`) but the service then looks the expense up by `_id` alone (`src/lib/services/expense.service.ts:337`). Any member of any group can GET/PATCH/DELETE any expense id.
- **Recurring generation is idempotent by construction, not by locking:** a partial unique index on `(recurringExpense, period)` (`src/lib/models/Expense.ts:137-140`) makes concurrent creation collide, duplicate-key errors are absorbed as success (`src/lib/services/recurring-expense.service.ts:296-299`), and the watermark advances only through the unbroken materialized prefix via `$max` (`src/lib/services/recurring-expense.service.ts:306-311`). The index is created by Mongoose `autoIndex` at model registration, which is [not awaited before writes](https://mongoosejs.com/docs/guide.html) — the integration test explicitly forces it (`src/lib/services/recurring-expense.integration.test.ts:51`); production does not.
- **`auth.config.ts` must stay Edge-safe _because the repo kept `middleware.ts`_.** Next.js 16 renamed the convention to `proxy`, and "[the `edge` runtime is **NOT** supported in `proxy` … If you want to continue using the `edge` runtime, keep using `middleware`](https://nextjs.org/docs/app/guides/upgrading/version-16)". This repo uses `src/middleware.ts:1-12`, so it is still on Edge, so the no-Node-imports rule in `src/lib/auth.config.ts:6-14` is still live.
- **Anonymous API calls get a 302 to `/login`, not a 401.** The `authorized` callback returns `false` for unauthenticated API paths (`src/lib/auth.config.ts:82`), and next-auth's middleware turns `false` into `NextResponse.redirect(signInUrl)` ([`packages/next-auth/src/lib/index.ts`](https://github.com/nextauthjs/next-auth/blob/main/packages/next-auth/src/lib/index.ts)). The in-code comment and test name claiming "401" (`src/lib/auth.config.ts:81`, `src/lib/auth.config.test.ts:68`) describe the route handlers' fallback, which middleware pre-empts.
- **Demo auth fails closed in production** — `isDemoAuthAllowed` requires `AUTH_MODE=demo` _and_, under `NODE_ENV=production`, an explicit `ALLOW_DEMO_AUTH=true` (`src/lib/auth-mode.ts:18-24`); the check is re-read inside `authorize()` at every sign-in attempt (`src/lib/auth.config.ts:23-28`).
- **One currency per group is enforced at write time and nowhere else.** `assertGroupCurrency` rejects any expense or settlement whose currency ≠ `group.defaultCurrency` (`src/lib/services/expense-validation.ts:59-63`). Group balances still _sum across currencies_ if legacy mixed data exists and only raise a flag (`src/lib/services/balance.service.ts:25-27`); the dashboard, by contrast, buckets per currency and never adds across them (`src/lib/services/balance.service.ts:148-201`, `src/lib/utils/dashboard.ts:8-33`).
- **`Group.category` is the single source of theme.** `getGroupTheme` maps it to a descriptor (`src/lib/group-themes.ts:39-121`) and _both_ the UI and the server branch on `theme.recurringExpenses` / `theme.signature` / `theme.header` rather than on the raw category string (`src/lib/services/recurring-expense.service.ts:46-50`, `src/components/groups/GroupDetailView.tsx:244,291`).
- **`docs/` is substantially stale and will actively mislead you.** `docs/api.md` documents an expense `tags` _array_ (`:226,248`) where the code has one required `tag` string (`src/lib/models/Expense.ts:111`), a `GET .../balances/simplified` endpoint that does not exist (`docs/api.md:301`), and receipt upload endpoints that exist nowhere (`docs/api.md:379-380`). `docs/ui.md:16-24` documents a palette and font that were replaced wholesale. Recurring expenses — the newest subsystem — appear in no core doc. Full list in §11.

---

## 1. Stack and build surface

### 1.1 Dependencies (`package.json`)

| Concern              | Package                                                                        | Version pin                                                                      |
| -------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Framework            | `next`                                                                         | `16.1.6` (exact) — `package.json:34`                                             |
| React                | `react` / `react-dom`                                                          | `19.2.3` (exact) — `package.json:36-37`                                          |
| Auth                 | `next-auth`                                                                    | `5.0.0-beta.30` (exact) + `@auth/mongodb-adapter ^3.11.1` — `package.json:24,35` |
| ODM / driver         | `mongoose ^9.2.0`, `mongodb ^7.1.0`                                            | `package.json:32-33`                                                             |
| UI                   | `@mui/material ^7.3.7`, `@mui/icons-material`, `@mui/material-nextjs`, Emotion | `package.json:26-30`                                                             |
| Validation           | `zod ^4.3.6`, imported as `zod/v4` at every call site                          | `package.json:40`; e.g. `src/lib/validators/expense.validator.ts:1`              |
| Client fetching      | `swr ^2.4.0`                                                                   | `package.json:39`                                                                |
| Dates                | `date-fns ^4.1.0`                                                              | `package.json:31`                                                                |
| Server-only tripwire | `server-only ^0.0.1`                                                           | `package.json:38`                                                                |
| Tests                | `vitest ^4.1.10`, `@playwright/test ^1.62.1`, `@axe-core/playwright`           | `package.json:43,44,54`                                                          |

Notably absent: any Node-side test-DB library (`mongodb-memory-server` etc.) — integration tests hit a real MongoDB (§9.2). Also absent: any decimal/money library.

### 1.2 Scripts (`package.json:5-22`)

`dev`/`build`/`start` are bare Next commands. `test` = `vitest run` (everything); `test:unit` excludes `src/**/*.integration.test.ts`; `test:integration` runs the files matching `integration`. `test:e2e` and `test:e2e:google` drive the two Playwright configs. `demo:seed` / `demo:reset` run `tsx scripts/*.ts`. `lint` is bare `eslint` — Next 16 [removed `next lint`](https://nextjs.org/docs/app/guides/upgrading/version-16) and this repo has already migrated.

### 1.3 Configs

- `next.config.ts` is **empty** (`next.config.ts:3-5`) — no `turbopack` block, no image config, no `taint`. Next 16 uses Turbopack by default with no flag ([upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)).
- `tsconfig.json` is `strict: true`, `moduleResolution: "bundler"`, path alias `@/* → ./src/*` (`tsconfig.json:7,11,21-23`).
- `eslint.config.mjs` is flat config composed of `eslint-config-next/core-web-vitals` + `.../typescript`, with `globalIgnores` re-declaring the defaults plus `.worktrees/**`, `coverage/**`, `playwright-report/**`, `test-results/**` (`eslint.config.mjs:5-22`). Note the ignore is `.worktrees/**` while the actual worktree path in use is `.claude/worktrees/…` — this file is therefore _not_ ignored by that entry.
- `vitest.config.ts`: `environment: 'node'`, `include: ['src/**/*.test.ts']` (so `.tsx` component tests are impossible under the current glob), `testTimeout: 20_000`, `hookTimeout: 30_000`, and two aliases — `@` and, critically, **`server-only` → `src/lib/test-utils/stubs/server-only.ts`** (`vitest.config.ts:5-18`).
- `playwright.config.ts`: port 3100, `globalSetup: ./playwright/global-setup.ts`, `fullyParallel: false`, `workers: 1`, four projects (desktop/mobile × light/dark, all Chromium) driven by `colorScheme` emulation, `webServer` env pinning `AUTH_MODE=demo`, `ALLOW_DEMO_AUTH=true`, `AUTH_TRUST_HOST=true` and the `splitwise-demo` database (`playwright.config.ts:16-98`).
- `playwright.google.config.ts`: port 3101, `AUTH_MODE=google`, a fake `AUTH_GOOGLE_ID` exported as `GOOGLE_MODE_CLIENT_ID` for assertions, one desktop-light project, **no** global setup (the OAuth flow is never completed so no seed is needed) (`playwright.google.config.ts:18-66`).

### 1.4 CI (`.github/workflows/ci.yml`)

Two jobs, both on `ubuntu-latest` with a `mongo:7` service container on 27017.

- `verify`: install → **`pnpm lint`** → **`pnpm test`** (unit + integration, with `TEST_MONGODB_URI=mongodb://127.0.0.1:27017/?directConnection=true`) → **`pnpm typecheck`** → **`pnpm build`** (`.github/workflows/ci.yml:30-53`). Order matters: tests run _before_ typecheck.
- `playwright`: install → install Chromium → build → `pnpm test:e2e` → `pnpm test:e2e:google` → upload reports/artifacts `if: always()` (`.github/workflows/ci.yml:76-108`).

There is **no `format:check` step** in CI even though the script exists (`package.json:11`).

### 1.5 Environment (`.env.example`)

`MONGODB_URI`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXT_PUBLIC_APP_URL`, `AUTH_MODE` (`google` default | `demo`), `ALLOW_DEMO_AUTH`, and optional `TEST_MONGODB_URI` (`.env.example:1-15`). `NEXT_PUBLIC_APP_URL` is the only browser-exposed variable, and it is consumed **server-side** to build invite URLs (`src/lib/services/group.service.ts:416`, `src/app/api/groups/[id]/invite-link/route.ts:52`) — meaning invite links break silently if it is unset in a given environment.

### 1.6 Scripts directory

`scripts/demo-seed.ts` and `scripts/demo-reset.ts` are thin CLIs: they `dotenv`-load `.env.local`, dynamically import `src/lib/demo/seed`, print a summary, and emit a Docker-run hint on connection errors (`scripts/demo-seed.ts:6-71`). Both print only the **database name and host** of `MONGODB_URI`, never credentials (`scripts/demo-seed.ts:35-43`). Neither guards against pointing at production — the only structural guard in the repo is the one in the integration-test helper (§9.2).

---

## 2. Request lifecycle, traced end to end

### 2.1 Write path — create an expense

| #   | Hop                                                                                                                                                                                           | Location                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------- | ------------------------ |
| 1   | User submits the dialog; client-side guards run first: description/amount, tag, split totals, payer totals                                                                                    | `src/components/expenses/ExpenseFormDialog.tsx:345-366`                                                |
| 2   | Split totals checked **client-side only** (`unequal`/`exact` must sum to amount within 0.01; percentages to 100; shares > 0)                                                                  | `src/components/expenses/ExpenseFormDialog.tsx:295-311`                                                |
| 3   | Multi-payer amounts checked client-side only                                                                                                                                                  | `src/components/expenses/ExpenseFormDialog.tsx:313-318`                                                |
| 4   | Advisory duplicate pre-check: `GET .../expenses/check-duplicate`, then a `window.confirm` if a match is found; failures are swallowed                                                         | `src/components/expenses/ExpenseFormDialog.tsx:390-412`                                                |
| 5   | `POST /api/groups/{id}/expenses` with the built payload                                                                                                                                       | `src/components/expenses/ExpenseFormDialog.tsx:371-422`                                                |
| 6   | **Middleware** — `NextAuth(authConfig).auth`, matched by `/((?!\_next/static                                                                                                                  | \_next/image                                                                                           | favicon.ico | ._\.._).*)` (API paths contain no dot, so they *are\* matched) | `src/middleware.ts:8,11` |
| 7   | `authorized` callback: not `/api/auth`, not a GET join preview, is `/api`, is logged in → `true`                                                                                              | `src/lib/auth.config.ts:62-91`                                                                         |
| 8   | Route handler POST: `getAuthUser()` → `unauthorized()` if no session                                                                                                                          | `src/app/api/groups/[id]/expenses/route.ts:25-26`                                                      |
| 9   | `const { id } = await params` — Next 16 requires async params ([upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16))                                                      | `src/app/api/groups/[id]/expenses/route.ts:28`                                                         |
| 10  | **Membership guard** `groupService.isMember(id, user.id)` → `forbidden()` (403)                                                                                                               | `src/app/api/groups/[id]/expenses/route.ts:31-32`; `src/lib/services/group.service.ts:126-133`         |
| 11  | **Zod** `createExpenseSchema.safeParse(body)` → `validationError` (422 with `details`)                                                                                                        | `src/app/api/groups/[id]/expenses/route.ts:35-36`; `src/lib/validators/expense.validator.ts:5-35`      |
| 12  | Service `expenseService.create(id, data, userId)`: `connectDB()`, load group                                                                                                                  | `src/lib/services/expense.service.ts:29-32`                                                            |
| 13  | Invariants: every payer & split participant is a member; tag is an _active_ group tag; currency == group default                                                                              | `src/lib/services/expense.service.ts:39-41`; `src/lib/services/expense-validation.ts:7-19,28-32,59-63` |
| 14  | `calculateSplitAmounts(splitMethod, amount, splitBetween)` resolves per-person amounts                                                                                                        | `src/lib/services/expense.service.ts:44`; `src/lib/services/split-calculation.ts:23-57`                |
| 15  | **Mongoose** `Expense.create({...})` — schema validators fire (min 0.01, max 10 000 000, ≥1 payer, ≥1 split, enum splitMethod)                                                                | `src/lib/services/expense.service.ts:46-60`; `src/lib/models/Expense.ts:86-110`                        |
| 16  | `activityService.log(groupId, 'expense_added', userId, {...})` — awaited, so a logging failure fails the request                                                                              | `src/lib/services/expense.service.ts:63-68`; `src/lib/services/activity.service.ts:9-22`               |
| 17  | Populate payer/split/creator names and return                                                                                                                                                 | `src/lib/services/expense.service.ts:70-74`                                                            |
| 18  | Route maps known service errors (`INVALID_MEMBERS`, `INVALID_TAG`, `CURRENCY_MISMATCH`) to **422** with human text; everything else → `serverError` (500, message swallowed, `console.error`) | `src/app/api/groups/[id]/expenses/route.ts:16-20,41-45`; `src/lib/utils/api-response.ts:52-55`         |
| 19  | Success envelope `{ data, status }` at HTTP 201                                                                                                                                               | `src/lib/utils/api-response.ts:17-19`                                                                  |
| 20  | Client revalidates **every** SWR key beginning `/api/groups/{id}` via a filter-function `mutate`                                                                                              | `src/components/expenses/ExpenseFormDialog.tsx:430`                                                    |

The response body shape for every success is `{ data: <payload>, status: <number> }`; every error is `{ error: string, status: number }` (plus `details` for Zod) — `src/lib/utils/api-response.ts:17-65`.

### 2.2 Read path A — list expenses

| #   | Hop                                                                                                                                                                                                                                                      | Location                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `ExpenseListView` builds a query string from filter state (either a controlled month range or quick/custom filters, plus search/category/tag/sort/page/limit=20)                                                                                         | `src/components/expenses/ExpenseListView.tsx:111-128`                                                            |
| 2   | `useSWR(key, fetcher, { refreshInterval: 10_000, keepPreviousData: true })`; key is `null` (fetch suppressed) when a custom range is invalid                                                                                                             | `src/components/expenses/ExpenseListView.tsx:130-136`                                                            |
| 3   | Middleware + `authorized` as in §2.1                                                                                                                                                                                                                     | `src/middleware.ts:8`; `src/lib/auth.config.ts:82,91`                                                            |
| 4   | `getAuthUser()` → `await params` → `isMember` → `forbidden()`                                                                                                                                                                                            | `src/app/api/groups/[id]/expenses/route.ts:52-58`                                                                |
| 5   | **A write happens here**: `recurringExpenseService.generateDueExpenses(id)` materializes any due recurring expenses _before_ the list is built                                                                                                           | `src/app/api/groups/[id]/expenses/route.ts:60-62`                                                                |
| 6   | Filters read straight off `searchParams`; no Zod on the query string; `page`/`limit` are raw `parseInt` with no upper bound                                                                                                                              | `src/app/api/groups/[id]/expenses/route.ts:64-80`                                                                |
| 7   | Service builds the Mongo query: `group` + `isDeleted:false`; quick-filter dates _or_ `dateFrom`/`dateTo` (with the `dateTo` end-of-day widening); `category`; `tag`; escaped case-insensitive regex on `description`; `paidBy.user`; `splitBetween.user` | `src/lib/services/expense.service.ts:89-131`; `src/lib/utils/date.ts:45-98`; `src/lib/utils/escape-regex.ts:1-3` |
| 8   | Three queries in parallel: paginated `find` (+4 populates), `countDocuments`, and a `$group` aggregation for `totalAmount`/`count` over the **whole filtered set**                                                                                       | `src/lib/services/expense.service.ts:138-160`                                                                    |
| 9   | If a `userId` or `includeMemberBreakdown` was requested and `total > limit`, a **second unbounded query** re-fetches `paidBy splitBetween` for the entire filtered set                                                                                   | `src/lib/services/expense.service.ts:168-174`                                                                    |
| 10  | `computeUserOweGetBack` and (opt-in) `computeMemberBreakdown` run over that window                                                                                                                                                                       | `src/lib/services/expense-summary.ts:56-107`                                                                     |
| 11  | Response `{ data: { expenses, pagination: {page,limit,total,totalPages}, summary: { totalAmount, count, userOwes, userGetsBack, byMember? } }, status: 200 }`                                                                                            | `src/lib/services/expense.service.ts:210-225`                                                                    |
| 12  | `fetcher` throws on `!res.ok`, preferring the server's `error` field, else `statusText`                                                                                                                                                                  | `src/lib/utils/fetcher.ts:1-8`                                                                                   |

### 2.3 Read path B — group balances

`BalancesView` fetches `/api/groups/{id}/balances` at `refreshInterval: 15_000` and `/api/groups/{id}/settlements` with SWR defaults (`src/components/balances/BalancesView.tsx:67-74`). The route does `getAuthUser` → `await params` → `isMember` → `balanceService.getGroupBalances(id)` → `notFound('Group')` when the group is missing (`src/app/api/groups/[id]/balances/route.ts:13-26`). The service:

1. `Promise.all` of every non-deleted expense, every settlement, and the populated group (`src/lib/services/balance.service.ts:17-21`).
2. `hasMixedCurrencies` = any expense **or** settlement whose currency ≠ `group.defaultCurrency` (`src/lib/services/balance.service.ts:25-27`).
3. Projects to `{paidBy:[{user,amount}], splitBetween:[{user,amount}]}` and `{paidBy,paidTo,amount}` — **currency is dropped at this point** (`src/lib/services/balance.service.ts:30-45`).
4. `calculateNetBalances`: `+payer.amount`, `−participant.amount`, then `+settlement.amount` to the payer and `−` to the payee, rounded to 2 dp (`src/lib/utils/debt-simplifier.ts:86-113`).
5. `simplifyDebts`: drop `|amount| < 0.01`, sort debtors and creditors largest-first, greedily transfer `min(debt, credit)` (`src/lib/utils/debt-simplifier.ts:32-67`).
6. Returns `{ balances: [{user, balance}], debts: [{from, to, amount}], currency: group.defaultCurrency, hasMixedCurrencies }` (`src/lib/services/balance.service.ts:84-89`).

Unknown user ids (e.g. a removed member who still appears in old expenses) render as `{ name: 'Unknown', email: '' }` rather than being dropped (`src/lib/services/balance.service.ts:68-81`).

### 2.4 API surface, verbs and guards

| Route                                       | Verbs              | Auth guard in the handler                                                                                                                                                              |
| ------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/[...nextauth]`                   | GET, POST          | Auth.js handlers (`src/app/api/auth/[...nextauth]/route.ts:1-2`)                                                                                                                       |
| `/api/groups`                               | POST, GET          | session only (`src/app/api/groups/route.ts:14,31`)                                                                                                                                     |
| `/api/groups/[id]`                          | GET, PATCH, DELETE | GET: session + inline member check + **lazy recurring generation**; PATCH/DELETE: session only, admin enforced in the service (`src/app/api/groups/[id]/route.ts:15-77`)               |
| `/api/groups/[id]/expenses`                 | POST, GET          | session + `isMember` (GET also generates recurring) (`…/expenses/route.ts:31,57,62`)                                                                                                   |
| `/api/groups/[id]/expenses/[expenseId]`     | GET, PATCH, DELETE | session + `isMember(params.id)` — **but the expense is fetched by `_id` alone** (`…/[expenseId]/route.ts:32,55,86`)                                                                    |
| `/api/groups/[id]/expenses/check-duplicate` | GET                | session + `isMember`; missing params return `{isDuplicate:false}` (`…/check-duplicate/route.ts:19-30`)                                                                                 |
| `/api/groups/[id]/balances`                 | GET                | session + `isMember` (`…/balances/route.ts:20`)                                                                                                                                        |
| `/api/groups/[id]/settlements`              | POST, GET          | session + `isMember`; payer/recipient authorization in the service (`…/settlements/route.ts:29,55`)                                                                                    |
| `/api/groups/[id]/activity`                 | GET                | session + `isMember` (`…/activity/route.ts:19`)                                                                                                                                        |
| `/api/groups/[id]/members/[userId]`         | PATCH, DELETE      | session only; admin/last-admin/self-removal enforced in the service (`…/members/[userId]/route.ts:31,59`)                                                                              |
| `/api/groups/[id]/tags`                     | POST               | session; admin + uniqueness in the service (`…/tags/route.ts:27`)                                                                                                                      |
| `/api/groups/[id]/tags/[tagId]`             | PATCH, DELETE      | session; admin + in-use check in the service (`…/tags/[tagId]/route.ts:32,61`)                                                                                                         |
| `/api/groups/[id]/invite`                   | POST               | session + `isMember` (any member may invite) (`…/invite/route.ts:25`)                                                                                                                  |
| `/api/groups/[id]/invite-link`              | POST, GET          | POST: session; **any member** may mint a code (service check) — no admin gate. GET: session + `isMember` (`…/invite-link/route.ts:22,43`; `src/lib/services/group.service.ts:403-404`) |
| `/api/groups/[id]/recurring`                | POST, GET          | POST: session; admin + Household enforced in the service. GET: session + `isMember` (`…/recurring/route.ts:44,61`)                                                                     |
| `/api/groups/[id]/recurring/[recurringId]`  | PATCH, DELETE      | session; service scopes by `{_id, group}` **and** requires admin (`…/[recurringId]/route.ts:45,66`; `src/lib/services/recurring-expense.service.ts:139,199`)                           |
| `/api/invitations`                          | GET                | session; scoped to `user.email` (`…/invitations/route.ts:10`)                                                                                                                          |
| `/api/invitations/[id]`                     | POST               | session; ownership by email match in the service (`…/[id]/route.ts:28,32`)                                                                                                             |
| `/api/join/[code]`                          | GET (public), POST | **GET has no session check at all** — deliberate invite preview. POST requires a session (`…/join/[code]/route.ts:14,41-53`)                                                           |
| `/api/user/balances`                        | GET                | session (`…/user/balances/route.ts:7`)                                                                                                                                                 |
| `/api/user/profile`                         | GET, PATCH         | session; GET lazily creates the `User` doc if missing (`…/user/profile/route.ts:28-38`)                                                                                                |

Two handlers bypass the response helpers and hand-roll `new Response(JSON.stringify(...))`, producing a body **without** the `status` field the rest of the API returns — `src/app/api/groups/[id]/tags/route.ts:28-42` and `src/app/api/groups/[id]/tags/[tagId]/route.ts:39-44,68-76`. Three "user error" cases are also returned as **500** because they are funnelled through `serverError`: last-admin demotion, last-admin removal, and self-removal (`src/app/api/groups/[id]/members/[userId]/route.ts:42-44,65-68`).

---

## 3. Domain model

Seven Mongoose models in `src/lib/models/`, all in the same database. `src/types/index.ts` mirrors them as plain interfaces for client code (`IUser`, `IGroup`, `IExpense`, …) — the model files carry the _document_ types with `mongoose.Types.ObjectId`, the `src/types` file carries the _wire_ types with `string | I<Ref>` unions.

### 3.1 Model registration — two different patterns

`User`, `Settlement`, `Activity`, `Invitation` use the classic `mongoose.models.X || mongoose.model(...)` guard (`src/lib/models/User.ts:31-32`, `Settlement.ts:36-37`, `Activity.ts:41-42`, `Invitation.ts:38-39`). `Group`, `Expense`, `RecurringExpense` instead **delete and re-register unconditionally** — `if (mongoose.models.X) mongoose.deleteModel('X')` followed by `mongoose.model(...)` (`src/lib/models/Expense.ts:144-147`, `Group.ts:102-105`, `RecurringExpense.ts:96-101`). The comment says "In development…", but there is no `NODE_ENV` guard, so this runs in production too. Practically it fires once per module evaluation; its visible consequence is that schema index declarations are re-submitted to Mongoose on every registration.

### 3.2 `Group` (`src/lib/models/Group.ts`)

| Field                                | Type / rules                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                               | required, trimmed, 1–100 (`:53-59`)                                                                                                                        |
| `description`                        | ≤500 (`:60`)                                                                                                                                               |
| `createdBy`                          | ref `User`, required (`:62`)                                                                                                                               |
| `members[]`                          | subdoc `{ user: ref User (req), role: 'admin'\|'member' default 'member', joinedAt default now }`, `_id: false` (`:36-43,63`)                              |
| `tags[]`                             | subdoc `{ name ≤50 required, isArchived default false, createdAt default now }` — **has** its own `_id` (`:45-49,64`)                                      |
| `defaultCurrency`                    | required, trimmed (no enum at the schema level; the Zod validator restricts it to `CURRENCY_CODES`) (`:65`; `src/lib/validators/group.validator.ts:32-34`) |
| `alternateCurrencies[]`              | validator: ≤2 entries (`:66-73`) — **stored but never used by any read path**                                                                              |
| `category`                           | enum `trip\|home\|couple\|work\|other`, default `other` (`:74-78`)                                                                                         |
| `startDate` / `endDate`              | nullable dates (`:79-80`)                                                                                                                                  |
| `isArchived`                         | default false (`:81`)                                                                                                                                      |
| `inviteCode` / `inviteCodeExpiresAt` | nullable, default null (`:82-83`)                                                                                                                          |

Indexes (`src/lib/models/Group.ts:91-98`): `{'members.user': 1}`, `{createdBy: 1}`, and a **partial unique** index on `inviteCode` filtered by `{ inviteCode: { $type: 'string' } }`. The in-file comment explains the choice, and it is correct: a sparse unique index still indexes _explicit_ nulls, so with `default: null` every code-less group would collide. MongoDB documents the partial form as the recommended alternative and states that "[if you specify both the `partialFilterExpression` and a unique constraint, the unique constraint only applies to the documents that meet the filter expression](https://www.mongodb.com/docs/manual/core/index-partial/)".

### 3.3 `Expense` (`src/lib/models/Expense.ts`)

Core fields: `group` (ref, req), `description` (1–200, trimmed), `amount` (**min 0.01, max 10 000 000**), `currency` (req), `category` (default `'other'`, free string), `date` (req), `paidBy[]` (≥1, each `{user, amount ≥ 0}`), `splitMethod` (enum of the five methods), `splitBetween[]` (≥1, each `{user, amount ≥ 0, percentage?, shares?}`), `tag` (**required**), `predefinedItem`, `receiptUrl`, `notes` (≤500) — `src/lib/models/Expense.ts:78-116`. Soft delete: `isDeleted` (default false), `deletedAt`, `deletedBy` (`:118-120`). Audit: `editHistory[]` of `{editedBy, editedAt, changes: Mixed}` (`:67-74,121`). Recurring linkage: `recurringExpense` (ref, default null) and `period` (`YYYY-MM` string, default null) (`:115-116`).

Indexes (`src/lib/models/Expense.ts:129-140`):

| Index                                                                                       | Purpose                                                                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `{group:1, date:-1}`                                                                        | default list sort                                                                                                  |
| `{group:1, isDeleted:1}`                                                                    | soft-delete filter                                                                                                 |
| `{group:1, tag:1}`                                                                          | tag filter                                                                                                         |
| `{group:1, category:1}`                                                                     | category filter                                                                                                    |
| `{description: 'text'}`                                                                     | **declared but unused** — the search filter uses `$regex`, not `$text` (`src/lib/services/expense.service.ts:120`) |
| `{recurringExpense:1, period:1}` unique, partial on `{recurringExpense:{$type:'objectId'}}` | the idempotency backbone of §5                                                                                     |

The partial filter is load-bearing: most expenses store `recurringExpense: null`, and a plain unique compound index would reject the second manual expense created in the same month.

Two schema-level gaps worth stating plainly: nothing enforces `sum(paidBy.amount) == amount`, nothing enforces `sum(splitBetween.amount) == amount`, and `sortOrder`/`sortBy` are the only fields the list query sorts on (`{[sortField]: sortOrder, createdAt: -1}`, `src/lib/services/expense.service.ts:140`) — there is no compound index matching `{group, amount}`.

### 3.4 `RecurringExpense` (`src/lib/models/RecurringExpense.ts`)

Mirrors `Expense`'s money/split fields (same 0.01–10 000 000 bounds, same enum, same ≥1 validators) minus `date`, plus the schedule: `dayOfMonth` (**1–31**), `startsOn` (req), `endsOn` (nullable), `isPaused` (default false), `lastGeneratedFor` (`YYYY-MM` string, default null) — `src/lib/models/RecurringExpense.ts:80-85`. One index: `{group: 1}` (`:92`). The uniqueness guarantee lives entirely on the `Expense` side.

### 3.5 `Settlement`, `Activity`, `Invitation`, `User`

- `Settlement`: `{group, paidBy, paidTo, amount ≥ 0.01, currency, note ≤500, createdBy}`, `timestamps: true`; indexes `{group,createdAt:-1}`, `{group,paidBy}`, `{group,paidTo}` (`src/lib/models/Settlement.ts:16-34`). Nothing prevents `paidBy === paidTo` at the schema level; the service does (`src/lib/services/expense-validation.ts:42-44`).
- `Activity`: `{group, type (8-value enum), actor, metadata: Mixed}` with `timestamps: {createdAt: true, updatedAt: false}`; index `{group, createdAt:-1}` (`src/lib/models/Activity.ts:13-39`). `metadata` is schemaless — every consumer type-narrows defensively (`src/lib/utils/activity-timeline.ts:58-100`).
- `Invitation`: `{group, invitedBy, invitedEmail (lowercased), status enum, token, expiresAt}`; indexes: unique `{token}`, `{invitedEmail, group}`, `{status, expiresAt}` (`src/lib/models/Invitation.ts:15-36`). The `{status, expiresAt}` index is not a TTL index — expiry is evaluated in queries (`src/lib/services/invitation.service.ts:24,57`) and lazily written on a failed accept (`:80-84`).
- `User`: `{name, email (lowercased), image, emailVerified, preferredCurrency default 'INR'}`, unique index on `email` (`src/lib/models/User.ts:14-28`). This model shares the `users` collection with the Auth.js MongoDB adapter (`src/lib/auth.ts:13`).

### 3.6 Ubiquitous language: does the code honour `CONTEXT.md`?

`CONTEXT.md:7-22` defines four terms. Verdict per term:

| Term         | Glossary definition                                                         | Code reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Theme**    | "A group's shape and identity … derived from the stored `Group.category`"   | **Honoured well.** `src/lib/group-themes.ts:39-121` is the single registry; consumers branch on `theme.header`/`theme.signature`/`theme.recurringExpenses`, not on the category string — including on the server (`src/lib/services/recurring-expense.service.ts:46-50,233`). The glossary says to avoid "group category", yet the persisted field, the type (`GroupCategory`, `src/types/index.ts:14`), the Zod enum (`src/lib/validators/group.validator.ts:31`) and the API all still say `category`. That is a deliberate "nothing new is stored" trade-off stated in the registry's own header comment (`src/lib/group-themes.ts:1-8`), but it means the wire vocabulary and the glossary diverge. |
| **Category** | "The fixed, global classification of an expense (`Expense.category`)"       | **Partly honoured.** `EXPENSE_CATEGORIES` is a fixed 10-item list (`src/lib/constants/categories.ts:7-18`) and the UI derives the value from the quick-pick (`src/components/expenses/expense-form-helpers.ts:67-70`). But `Expense.category` is a free `String` in the schema (`src/lib/models/Expense.ts:88`) and the Zod schema is `z.string().default('other')` (`src/lib/validators/expense.validator.ts:11`) — `CATEGORY_IDS` is imported into that file (`:3`) and **never used**. Arbitrary category strings are accepted by the API.                                                                                                                                                           |
| **Tag**      | "group-scoped, user-managed … exactly one per expense, required"            | **Honoured.** `Expense.tag` is `required` (`src/lib/models/Expense.ts:111`), Zod requires a non-empty string (`src/lib/validators/expense.validator.ts:32`), and the service rejects any tag that is not an _active_ `Group.tags` entry (`src/lib/services/expense-validation.ts:28-32`). Every new group is seeded with theme-specific active tags so the first expense is never blocked (`src/lib/constants/default-tags.ts:15-21`, `src/lib/services/group.service.ts:27`). Editing keeps an already-archived tag if it is unchanged (`src/lib/services/expense-validation.ts:21-26`).                                                                                                               |
| **Month**    | "a read-only lens … in the viewer's own timezone — never a ledger boundary" | **Honoured, with one seam.** The `?month=YYYY-MM` param produces a viewer-local range (`src/components/groups/MonthCycleBar.tsx:46-66`), the expense list re-queries with `dateFrom`/`dateTo` (`src/components/expenses/ExpenseListView.tsx:112-115`), and balances stay running — the month view never touches them (`src/components/groups/GroupDetailView.tsx:172-192`). The seam: recurring **periods** are UTC calendar months (`src/lib/recurring-due-periods.ts:28-32`) and generated expenses are dated at UTC midnight (`:60`), so a generated expense can land in the neighbouring month's lens for viewers west of UTC.                                                                      |

---

## 4. Business logic

### 4.1 Split calculation — all five methods (`src/lib/services/split-calculation.ts`)

```ts
if (splitMethod === 'equal') {
  const perPerson = Math.floor((amount * 100) / splitBetween.length) / 100;
  const remainder = Math.round((amount - perPerson * splitBetween.length) * 100) / 100;
  return splitBetween.map((p, i) => ({
    ...p,
    amount: i === 0 ? perPerson + remainder : perPerson,
  }));
}
```

(`src/lib/services/split-calculation.ts:28-36`)

| Method       | Behaviour                                                                                                                  | Rounding / remainder                                                                                                                                                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `equal`      | floor to cents, remainder to **index 0**                                                                                   | Exact by construction: `perPerson*n + remainder == amount` (to float precision). Test asserts 100/3 → `[33.34, 33.33, 33.33]` (`split-calculation.test.ts:22-34`). Note `perPerson + remainder` is a _float addition_, so index 0's stored value can be `33.340000000000003`; the test uses `toBeCloseTo` rather than equality (`:30`). |
| `shares`     | `round(shares/total * amount, 2)` per participant; **no-op when total shares is 0** (returns the input array by reference) | **Can drift.** 100 across 3 equal shares → `[33.33, 33.33, 33.33]`, total 99.99 — asserted explicitly (`split-calculation.test.ts:89-97`).                                                                                                                                                                                              |
| `percentage` | `round(pct/100 * amount, 2)` per participant                                                                               | **Can drift** the same way; nothing checks percentages sum to 100 server-side. Missing `percentage` is treated as 0 (`:52`, test `:150-158`).                                                                                                                                                                                           |
| `unequal`    | caller amounts pass through unchanged                                                                                      | **No server-side sum check.**                                                                                                                                                                                                                                                                                                           |
| `exact`      | identical to `unequal` — the two are behaviourally indistinguishable in the service (`:56`)                                | **No server-side sum check.**                                                                                                                                                                                                                                                                                                           |

`calculateSplitAmounts` is called on create (`src/lib/services/expense.service.ts:44`), on update — but **only when `splitBetween` _and_ `splitMethod` _and_ `amount` are all present in the patch** (`src/lib/services/expense.service.ts:289-291`) — and on both recurring create (`src/lib/services/recurring-expense.service.ts:98`) and every generation (`:273-277`).

### 4.2 Debt simplification (`src/lib/utils/debt-simplifier.ts`)

Two exports. `calculateNetBalances` folds expenses (`+paid`, `−share`) and settlements (`+` to the payer who is clearing their debt, `−` to the recipient) into a `Map`, rounding each final balance to 2 dp (`:86-113`). `simplifyDebts` is a **greedy two-pointer match**, not an optimal solver: drop `|amount| < 0.01`, sort debtors and creditors descending, repeatedly transfer `min(debtors[i], creditors[j])` and advance whichever side falls below 0.01 (`:30-67`). Transfers below 0.01 are computed but not emitted (`:52`).

Greedy largest-first is a heuristic; it is not guaranteed minimal for all inputs, and the code makes no such claim beyond the docstring "minimize the number of transactions" (`:20`). The tests pin two-person and three-person cases and the zero-sum invariant (`src/lib/utils/debt-simplifier.test.ts:124-155,170-188`) but not a general optimality property.

### 4.3 Balances — group vs dashboard

**Group** (`src/lib/services/balance.service.ts:13-90`, traced in §2.3): a single currency-blind fold, plus a `hasMixedCurrencies` boolean.

**Dashboard / cross-group** (`src/lib/services/balance.service.ts:95-218`): loads all non-archived groups the user belongs to, then all expenses and settlements for those groups in **two** queries, buckets them by group in memory (`:106-125`), and for each group iterates the _distinct currencies present_ (`:134-148`). For each currency it filters, folds, and finds the caller's balance; balances under 0.01 are dropped entirely (`:171`). It then re-runs `simplifyDebts` on that currency's balances and picks the caller's **largest** transfer as the suggested counterparty (`:173-184`). The per-group `hasMixedCurrencies` here is `currencies.size > 1` — a different definition from the group endpoint's "differs from `defaultCurrency`" (`:208` vs `:25-27`).

`aggregateCurrencyBalances` then rolls the per-group, per-currency figures into `{currency, youOwe, youAreOwed, net}` buckets, sorted by currency code, rounding after every addition with an `Number.EPSILON`-nudged half-up helper (`src/lib/utils/dashboard.ts:3-33`). **No code path adds two different currencies together.**

`selectNextAction` picks one CTA in strict priority order: create-group (no groups) → settle the largest payable debt (ties broken by group `updatedAt`) → review invitations → add an expense to the most recently updated group (`src/lib/utils/dashboard.ts:35-93`).

### 4.4 Settlement authorization

`canRecordSettlement(actorId, paidBy, paidTo)` is a one-line pure predicate — either party may record (`src/lib/utils/settlement-authorization.ts:5-7`). It is re-exported through the service-side assertion layer so client and server share one definition (`src/lib/services/expense-validation.ts:47-57`). `SettlementService.create` defaults `paidBy` to the caller when omitted, then asserts membership of both parties, distinctness, authorization, and currency (`src/lib/services/settlement.service.ts:24-28`). Errors map to 422 with specific messages (`src/app/api/groups/[id]/settlements/route.ts:14-19`). Settlements are **immutable**: there is no update or delete path anywhere in the codebase — the only way to reverse one is to record its inverse.

### 4.5 Expense summary and member breakdown

`computeMemberBreakdown(expenses, memberIds)` produces exactly one row per listed member — including all-zero rows for inactive members, so the UI table has a stable row set across months (`src/lib/services/expense-summary.ts:56-84`). Amounts attributed to ids **not** in `memberIds` are silently discarded (`:68,74`), which is how removed members' historical amounts vanish from a breakdown while remaining in the balance fold. `computeUserOweGetBack` walks the same window once, netting each expense's `share − paid` for the caller and accumulating into two positive figures (`:90-107`). Both round to cents at the end only (`:42-44`).

The breakdown is **opt-in**: `includeMemberBreakdown=1` on the query (`src/app/api/groups/[id]/expenses/route.ts:79`), which the month view sets (`src/components/expenses/ExpenseListView.tsx:115`). Missing members render as `'Former member'` (`src/lib/services/expense.service.ts:196`).

### 4.6 Soft delete, restore and edit history

`delete` sets `isDeleted/deletedAt/deletedBy` and logs `expense_deleted`; the document is never removed (`src/lib/services/expense.service.ts:334-352`). Restore is expressed as a _patch_: `updateExpenseSchema` allows only the literal `isDeleted: false` (`src/lib/validators/expense.validator.ts:37-39`), and `update` short-circuits on it — clearing the delete markers, logging `expense_updated` with `action: 'restored'`, and returning early **without** touching any other field (`src/lib/services/expense.service.ts:259-276`). The client exposes this as an undo snackbar (`src/components/expenses/ExpenseListView.tsx:170-183`).

Edit history is diffed by `JSON.stringify` comparison of each patched key against the current document, with `isDeleted` excluded (`src/lib/services/expense.service.ts:294-301`); a non-empty diff pushes an `editHistory` entry _and_ logs an activity carrying the full `changes` object (`:304-322`). Two consequences: `JSON.stringify` equality on `Date` and `ObjectId` values means a same-value re-submit can still register as a change, and the `changes` payload is written verbatim into the activity feed's `metadata`.

### 4.7 Activity logging

One method: `Activity.create({group, type, actor, metadata})` (`src/lib/services/activity.service.ts:9-22`). Every call site **awaits** it inside the request, so a failed log fails the mutation. Eight event types are logged (`src/lib/models/Activity.ts:18-27`); role changes, archiving and group edits all reuse `group_updated` with a `changes` payload (`src/lib/services/group.service.ts:93,116-118,204-211`). The feed endpoint paginates newest-first with `page`/`limit` defaults of 1/20 (`src/lib/services/activity.service.ts:27-50`), and `src/lib/utils/activity-timeline.ts:23-108` turns rows into day-grouped headlines — including the `(recurring)` suffix driven by `metadata.recurring` (`:50-52`).

### 4.8 Invitations and invite codes — two independent mechanisms

**Email invitations.** `create` rejects a second _pending, unexpired_ invitation for the same `(group, email)` with `ALREADY_INVITED` → 409 (`src/lib/services/invitation.service.ts:20-29`; route `src/app/api/groups/[id]/invite/route.ts:37-39`). Token is `crypto.randomBytes(16).toString('hex')` (32 hex chars) with a hard-coded 7-day expiry (`:31-33`). **Nothing sends an email** — no mail transport exists in the repo; the invitee discovers the invitation by polling `GET /api/invitations`, which filters on their own session email (`src/app/api/invitations/route.ts:10`). Ownership on accept/decline is an exact case-insensitive email match, and a mismatch returns `null` → **404**, not 403 (`src/lib/services/invitation.service.ts:74,121`; `src/lib/services/invitation-ownership.ts:1-3`). Accept flips status, then adds the member if not already present; the `token` field is generated and stored but **no route ever consumes it**.

**Invite codes.** `generateInviteCode` requires membership only — not admin — and mints `crypto.randomBytes(4).toString('hex')`, i.e. **8 hex characters / 32 bits of entropy**, with a caller-supplied expiry defaulting to 7 days (`src/lib/services/group.service.ts:397-419`). `expiresInDays` comes straight off the request body with no validation and no ceiling (`src/app/api/groups/[id]/invite-link/route.ts:19-22`). Regenerating overwrites the previous code, so a group has at most one live code. `findByInviteCode` requires a non-expired code and a non-archived group (`src/lib/services/group.service.ts:424-433`). `GET /api/join/[code]` is public and returns `{_id, name, category, memberCount}` (`src/app/api/join/[code]/route.ts:41-53`); `POST` requires a session, is idempotent for existing members, and joins with role `member` and activity method `'link'` (`:12-34`).

### 4.9 Group and tag management

`GroupService.create` makes the creator the sole admin and seeds theme-specific default tags in the same insert (`src/lib/services/group.service.ts:17-28`). Admin-only operations throw the sentinel string `'FORBIDDEN'`, which routes map to 403 (`:76-78,109-111,186-188,229-231,276-278,322-324,365-367`). Last-admin protection covers both demotion and removal (`:194-199,241-246`), and self-removal is blocked with `SELF_REMOVE` (`:232-235`).

Tag mutations deliberately avoid Mongoose change tracking and use atomic operators: `$push` for add, positional `tags.$.` `$set` for update, `$pull` for delete (`:288-302,341-350,385-390`). Case-insensitive uniqueness is checked by a **read-then-write** (`:281-285,330-338`) — not atomic, so two concurrent adds of the same name both succeed. Deleting a tag is blocked when any expense in the group references it by name, reported as `TAG_IN_USE:<count>` → 400 (`:373-382`; route `src/app/api/groups/[id]/tags/[tagId]/route.ts:68-76`). Renaming a tag does **not** rewrite the `Expense.tag` strings that point at it, so a rename orphans historical expenses from the active-tag set — which the expense form specifically compensates for (`src/components/expenses/expense-form-helpers.ts:23-39`).

---

## 5. Recurring expenses (v4 phase 3)

Two modules: a pure scheduler (`src/lib/recurring-due-periods.ts`) and a service that materializes (`src/lib/services/recurring-expense.service.ts`). There is **no cron, queue or scheduled function anywhere in the repo** — generation happens as a side effect of reads.

### 5.1 The period model (`src/lib/recurring-due-periods.ts`)

A period is a **UTC calendar month** keyed `YYYY-MM`, zero-padded so lexicographic string comparison is chronological (`:28-32`) — this is precisely what makes `$max` on a string field a valid monotonic advance. `nextPeriod`/`previousPeriod` shift through `Date.UTC(year, month-1+delta, 1)` so year boundaries are handled by the Date constructor (`:34-46`).

**Month-length clamping** lives in `expenseDateForPeriod`: `daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()`, then `day = min(max(1, trunc(dayOfMonth)), daysInMonth)` at UTC midnight (`:52-61`). A `dayOfMonth: 31` template lands on Feb 28 (or 29 in a leap year) and on the 30th in 30-day months. Malformed periods throw — treated as programmer error (`:53-55`).

`getDuePeriods(schedule, currentPeriod)` (`:77-110`) returns the due list oldest-first and is pure:

1. Paused → `[]` (`:78`). Malformed `currentPeriod` → `[]` (`:79`).
2. `startsOn` normalized to UTC start-of-day; `endsOn` to UTC end-of-day; invalid dates or an inverted window → `[]` (`:81-86`).
3. A malformed stored `lastGeneratedFor` is defensively treated as absent (`:89-92`).
4. Cursor = `max(month(startsOn), nextPeriod(lastGeneratedFor))` (`:96-99`).
5. Walk forward while `cursor <= currentPeriod`, emitting a period only when its **clamped expense date** falls inside `[startsOn, endsOn]` (`:102-108`).

Step 5 is why a template starting on the 20th with `dayOfMonth: 1` skips its own first month — the clamped date (the 1st) precedes `startsOn` — a case the integration suite pins (`src/lib/services/recurring-expense.integration.test.ts:265`).

### 5.2 Generation (`src/lib/services/recurring-expense.service.ts:223-315`)

Entry conditions: the group has templates (`:229-230`), exists, and its **theme** allows recurring expenses — Household only (`:232-235`; `src/lib/group-themes.ts:63`). Then per template:

1. `getDuePeriods(...)` → skip if empty (`:241-251`).
2. **Problem-state skip.** `assertTemplateData(group, template)` re-runs the same membership / active-tag / currency invariants manual expenses go through; a throw `continue`s to the next template **without advancing the marker** (`:253-257`). So a template whose tag was archived or whose payer left the group stops generating silently on the server and is surfaced in the settings UI instead (`src/components/groups/RecurringExpensesSection.tsx:170-183,449-455`). When the problem is fixed, the untouched marker makes the next read catch up the whole missed window at once (test: `recurring-expense.integration.test.ts:233`).
3. For each due period, `Expense.create({... recurringExpense: template._id, period, date: expenseDateForPeriod(...), splitBetween: calculateSplitAmounts(...), createdBy: template.createdBy })` (`:264-282`), then an `expense_added` activity carrying `recurring: true`, `recurringExpenseId` and `period` (`:286-294`).
4. **Duplicate-key absorption.** `err.code === 11000` (`:70-72`) is treated as _success by someone else_: `materializedThrough = period; continue` (`:296-300`). Any other error is logged and **breaks** the loop for that template (`:301-302`).
5. **Unbroken-prefix advance.** After the loop, `RecurringExpense.updateOne({_id}, { $max: { lastGeneratedFor: materializedThrough } })` (`:306-311`).

### 5.3 The concurrency and idempotency argument, precisely

- **Uniqueness** comes from `{recurringExpense: 1, period: 1}` unique with `partialFilterExpression: { recurringExpense: { $type: 'objectId' } }` (`src/lib/models/Expense.ts:137-140`). Two concurrent readers both compute the same due list, both attempt the insert, and MongoDB rejects the loser with error 11000. The loser treats that as materialized. The integration test races five concurrent `generateDueExpenses` calls and asserts exactly one expense and a summed `generated` of exactly 1 (`src/lib/services/recurring-expense.integration.test.ts:138-160`).
- **Monotonicity** comes from `$max`, which "[updates the value of the field to a specified value if the specified value is greater than the current value](https://www.mongodb.com/docs/manual/reference/operator/update/max/)" using BSON comparison order. `lastGeneratedFor` defaults to `null`, and Null sorts before String, so the first advance always applies; thereafter zero-padded `YYYY-MM` strings compare chronologically. A slow reader that finishes second can never rewind a faster reader's marker.
- **Crash safety** comes from the marker being advanced _after_ the inserts. A process that dies mid-loop leaves the marker behind; the next read recomputes the same due list, hits duplicate keys for the already-created periods, absorbs them, and advances. The state is self-healing without a transaction.
- **The prefix rule** is what keeps a mid-window failure from silently losing a month: `materializedThrough` only ever holds the _last consecutively materialized_ period, and an unexpected error `break`s before it can be updated further (`:301-303`). The marker therefore never jumps over a gap.
- **The pause/resume rule** is a deliberate history rewrite. `getDuePeriods` returns `[]` while paused (`src/lib/recurring-due-periods.ts:78`), so the on-hold months accumulate as "due". On resume (`wasPaused && data.isPaused === false`), `update` fast-forwards the marker to `previousPeriod(currentPeriod)` — but only forward, guarded by `if (!lastGeneratedFor || lastGeneratedFor < previous)` (`src/lib/services/recurring-expense.service.ts:178-183`). Generation therefore resumes at the **current** month and the paused window is never back-filled (test: `:199`).
- **Template edits apply forward only.** Already-generated expenses are ordinary expenses and are never rewritten; deleting a template hard-deletes only the template (`:196-209`, test `:321`).

### 5.4 Actual failure modes

1. **Writes in GET handlers.** `generateDueExpenses` is invoked from `GET /api/groups/[id]/expenses` (`src/app/api/groups/[id]/expenses/route.ts:62`) and `GET /api/groups/[id]` (`src/app/api/groups/[id]/route.ts:33`) — both of which the client polls on a 10–30 s SWR interval (§8). Every group-detail render therefore performs at minimum one `RecurringExpense.find` and one `Group.findById` before the read it was asked for, and month-boundary reads perform inserts. GET requests are not idempotent in this app.
2. **Index-creation race in production.** The uniqueness argument depends on the partial unique index existing. Mongoose builds schema indexes automatically via `autoIndex` at model registration, which the docs describe as asynchronous and recommend disabling in production ([Mongoose guide](https://mongoosejs.com/docs/guide.html)); no code awaits it. The integration test knows this and calls `await Expense.createIndexes()` in `beforeAll` with an explicit comment (`src/lib/services/recurring-expense.integration.test.ts:49-52`). No equivalent exists on the serving path, so the very first concurrent generation after a fresh deploy against a fresh collection can duplicate.
3. **Non-atomic multi-document work.** Each period is `Expense.create` + `Activity.create` + (eventually) the marker update, with no transaction. A failure between the expense insert and the activity insert leaves an expense with no feed entry; the duplicate-key path then absorbs the retry and the activity is never written.
4. **Activity duplication under the race is possible in the other direction**: the winner writes both expense and activity; the loser's insert fails before its activity write, so activities are not duplicated — but this holds only because the activity log is _after_ the create (`:283-294`).
5. **Timezone skew.** `currentPeriod = toPeriod(now)` is UTC (`:237`; `src/lib/recurring-due-periods.ts:28-32`), while the Month lens is viewer-local (`src/components/groups/MonthCycleBar.tsx:52-64`). Near a month boundary the two disagree about which month a freshly generated expense belongs to.
6. **Silent stop on problem state.** The server-side skip is invisible in the API response — `generateDueExpenses` returns only `{generated}` and never throws into the read path (`:223-226,314`). Detection relies entirely on the settings-page heuristic (`src/components/groups/RecurringExpensesSection.tsx:172-183`), which reproduces the tag/member checks in the client but **not** the currency check that `assertTemplateData` also applies (`src/lib/services/recurring-expense.service.ts:66`). A currency-drifted template stops generating with no UI indication.
7. **Soft-deleted generated expenses never regenerate.** The unique index keys on `(recurringExpense, period)` regardless of `isDeleted` (`src/lib/models/Expense.ts:137-140`), and `expensesFor` in the tests filters on `isDeleted: false` (`recurring-expense.integration.test.ts:87`) — so deleting a generated rent expense removes it permanently for that month.

---

## 6. Auth

### 6.1 The Edge/Node split, and why it still exists in Next 16

Two NextAuth instantiations share one config object:

- `src/lib/auth.config.ts` — providers, session strategy, callbacks, `pages`. Its header comment states it "must NOT import any Node.js-only modules … because it's used by middleware which runs in the Edge runtime" (`:6-10`). Its only imports are `next-auth` types, the two providers, and `@/lib/demo-credentials`, which in turn only pulls `auth-mode` and `demo-personas` — both explicitly Edge-safe and dependency-free (`src/lib/auth-mode.ts:1-4`, `src/lib/demo-personas.ts:1-4`).
- `src/lib/auth.ts` — spreads that config and adds `adapter: MongoDBAdapter(clientPromise)` (`:11-14`). This is exactly the split-config pattern Auth.js prescribes, for the stated reason that "[middleware code always runs in an edge runtime … trying to execute … queries in an environment where the underlying functionality is not available (i.e. TCP sockets)](https://authjs.dev/guides/edge-compatibility)", and it is why the session strategy must be `jwt` (`src/lib/auth.config.ts:39-41`) — middleware validates the token cryptographically without a database round-trip.

The version-specific nuance: Next.js 16 deprecated the `middleware` convention in favour of `proxy`, and "[the `edge` runtime is **NOT** supported in `proxy`. The `proxy` runtime is `nodejs`, and it cannot be configured. If you want to continue using the `edge` runtime, keep using `middleware`](https://nextjs.org/docs/app/guides/upgrading/version-16)". This repo has **not** migrated — it still ships `src/middleware.ts` with `export default NextAuth(authConfig).auth` (`:1-8`). So it remains on the Edge runtime and the Edge-safety constraint is genuinely load-bearing today. Migrating the file to `proxy.ts` would move it to Node and make the constraint moot (while also making a `proxy`-based auth check subject to Next's own warning that Server Functions can silently fall outside the matcher).

### 6.2 The middleware matcher

`matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)']` (`src/middleware.ts:11`). Next.js documents that "[without a `matcher`, Proxy runs on every request, including static files](https://nextjs.org/docs/app/api-reference/file-conventions/middleware)" and shows this negative-lookahead form as the recommended exclusion pattern. The `.*\..*` clause excludes any path containing a dot — the blanket "has a file extension" heuristic. Crucially, `/api/...` is **not** excluded (unlike the doc's example, which excludes `api`), which is what lets the `authorized` callback gate the API surface. The corollary is that an API path containing a dot (say `/api/groups/a.b/expenses`) skips middleware entirely and relies on the handler's own `getAuthUser()` — defence in depth that does exist (`src/lib/utils/api-response.ts:8-12`).

### 6.3 Dual providers and `AUTH_MODE`

Both providers are **always registered**, so `AUTH_MODE` can flip without a rebuild (`src/lib/auth.config.ts:11-12,15-35`):

- `Credentials({ id: 'demo', credentials: { personaId } })` whose `authorize` delegates to `authorizeDemoPersona` (`:16-29`).
- `Google({ clientId: process.env.AUTH_GOOGLE_ID!, clientSecret: ... })` (`:30-33`).

`authorizeDemoPersona` reads env **at authorize time** (not module load) so the production guard cannot be defeated by a stale module-scope read, and returns `null` unless demo auth is allowed _and_ the persona is on the allowlist (`src/lib/demo-credentials.ts:24-39`). The allowlist is three fixed personas with hard-coded ObjectId strings, looked up by key (`'alex'`) or by id (`src/lib/demo-personas.ts:19-23,69-73`).

`isDemoAuthAllowed` is the **fail-closed guard**: `AUTH_MODE` must be exactly `'demo'`, and under `NODE_ENV === 'production'` it additionally requires `ALLOW_DEMO_AUTH === 'true'` (`src/lib/auth-mode.ts:18-24`). `resolveAuthMode` defaults to `'google'` whenever demo is unset _or blocked_ (`:30-32`) — so a misconfigured production deploy degrades to Google rather than opening a passwordless door. Both Playwright configs set `ALLOW_DEMO_AUTH`/`AUTH_TRUST_HOST` explicitly because CI serves a production build (`playwright.config.ts:86-90`).

UI entry points ask `isDemoMode()` rather than reading the env: the landing route swaps the marketing page for the persona picker (`src/app/page.tsx:14-18`), `/login` swaps the Google button for the demo client (`src/app/(auth)/login/page.tsx:10,33`), the join page passes the mode down (`src/app/join/[code]/page.tsx:6`), and the navbar gets a demo badge (`src/app/(main)/layout.tsx:23`). Sign-in never hard-codes a provider id — `getSignInProvider(mode)` does (`src/lib/auth-sign-in.ts:8-10`).

**Consequence of Credentials + JWT:** the demo path never touches the MongoDB adapter, so signing in as a persona does **not** create a `User` document. Persona users exist only because `pnpm demo:seed` upserts them with the same fixed ids (`src/lib/demo/seed.ts:34-56`). Signing in as a persona against an unseeded database yields a session whose `user.id` matches no `User` row.

### 6.4 Session shape

`session: { strategy: 'jwt' }` (`src/lib/auth.config.ts:39-41`). The `jwt` callback copies `user.id` onto the token **only on the initial sign-in** (when `user` is present) (`:43-48`); the `session` callback copies it back onto `session.user.id` (`:49-54`). `src/types/next-auth.d.ts` augments the types. Everything server-side reads `user.id` via `getAuthUser()` (`src/lib/utils/api-response.ts:8-12`). Because the id is baked into the JWT at sign-in and never refreshed, a session outlives changes to the underlying user record.

### 6.5 Exactly which routes are public

`authorized` (`src/lib/auth.config.ts:55-92`) classifies, in order:

| Condition                                                        | Result                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pathname.startsWith('/api/auth')`                               | `true` — always (`:62,68`)                                                                                                      |
| `pathname.startsWith('/api/join/') && method === 'GET'`          | `true` — **the deliberate exception**, so the join page can render its sign-in CTA before the user has an account (`:63-64,71`) |
| Logged in **and** `pathname.startsWith('/login')`                | 302 → `/dashboard` (`:74-76`)                                                                                                   |
| `pathname === '/'` or `pathname.startsWith('/join')` or `/login` | `true` (`:61,79`)                                                                                                               |
| `pathname.startsWith('/api')` and not logged in                  | `false` (`:82`)                                                                                                                 |
| anything else, not logged in                                     | 302 → `/login?callbackUrl=<pathname>` (`:85-89`)                                                                                |
| otherwise                                                        | `true` (`:91`)                                                                                                                  |

Two things a reader must not get wrong. First, `false` does **not** produce a 401: next-auth's middleware converts it into `NextResponse.redirect(signInUrl)` with `callbackUrl` set ([`packages/next-auth/src/lib/index.ts`](https://github.com/nextauthjs/next-auth/blob/main/packages/next-auth/src/lib/index.ts)). An unauthenticated `fetch('/api/groups')` from the browser follows the 302, receives the `/login` HTML with a 200, `res.json()` throws and is swallowed by `.catch(() => ({}))`, and `fetcher` returns `{}` — a silent empty success rather than an error (`src/lib/utils/fetcher.ts:1-8`). The `(will return 401)` comment (`src/lib/auth.config.ts:81`) and the test name `'rejects anonymous API calls (returns false -> 401)'` (`src/lib/auth.config.test.ts:68`) describe the handlers' own `unauthorized()` fallback, which only fires for requests that bypass middleware. The Google E2E suite in fact asserts the redirect behaviour for pages (`playwright-google/google-auth.spec.ts:32-35`).

Second, `startsWith('/join')` also matches paths like `/joinery`, and `startsWith('/login')` matches `/loginfoo` — both are prefix, not segment, matches.

### 6.6 Layered guards

Public and protected pages each carry their own check independent of middleware: `src/app/(main)/layout.tsx:9-13` calls `auth()` and `redirect('/login')`; `src/app/(main)/groups/[id]/page.tsx:6-7` repeats it; `src/app/page.tsx:8-12` redirects logged-in users to the dashboard. Every API handler independently calls `getAuthUser()`. So middleware is an optimization and a UX layer, not the only boundary.

---

## 7. Theming and UI architecture

### 7.1 Two independent "themes"

The word means two different things in this codebase, and conflating them is the fastest way to misread it.

1. **Group theme** — the domain concept from `CONTEXT.md`, a pure descriptor derived from `Group.category` (`src/lib/group-themes.ts`).
2. **Visual theme** — the MUI light/dark palette built from semantic design tokens (`src/lib/theme/tokens.ts`, `src/lib/theme/createAppTheme.ts`).

### 7.2 The group-theme registry (`src/lib/group-themes.ts`)

`GroupTheme` carries: `label`, `tagline`, `perk`, `icon`, `header: 'strip'|'neutral'`, `dates: 'bounded'|'openEnded'`, `signature: 'checklist'|'monthCycle'|'none'`, `recurringExpenses: boolean`, `defaultTags`, `nouns`, `namePlaceholder` (`:13-37`).

| Category | Label         | `header` | `dates`   | `signature`  | `recurringExpenses` |
| -------- | ------------- | -------- | --------- | ------------ | ------------------- |
| `trip`   | Trip          | `strip`  | bounded   | `checklist`  | false               |
| `home`   | **Household** | neutral  | openEnded | `monthCycle` | **true**            |
| `couple` | Couple        | neutral  | openEnded | none         | false               |
| `work`   | Work          | neutral  | openEnded | none         | false               |
| `other`  | General       | neutral  | openEnded | none         | false               |

(`src/lib/group-themes.ts:39-110`.) `getGroupTheme` falls back to `other` for unknown stored values (`:119-121`). Consumption sites and what each flag changes:

| Flag                         | Consumer                                                                                                 | Effect                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `header === 'strip'`         | `GroupDetailView.tsx:244`, `GroupCard.tsx:113`                                                           | renders `TripStrip` (boarding-pass) instead of `GroupHeader`                                                                |
| `signature === 'checklist'`  | `GroupDetailView.tsx:291`                                                                                | renders the three-step "Get this trip going" checklist, built by `buildTripChecklist` (`src/lib/utils/trip-setup.ts:49-81`) |
| `signature === 'monthCycle'` | `GroupDetailView.tsx:158,173`; `GroupCard.tsx:171`                                                       | renders `MonthCycleBar`, enables the `?month=` lens, and changes the header date label to "Tracking since …"                |
| `recurringExpenses`          | **server** `recurring-expense.service.ts:47,233`; **client** `GroupSettingsView.tsx:744`                 | gates template creation, gates generation entirely, and gates the settings section                                          |
| `nouns.singular`             | `BalancesView.tsx:182`, `ExpenseFormDialog.tsx:87`, `ExpenseListView.tsx:573`, `GroupDetailView.tsx:148` | copy nouns — no component hardcodes "trip" in these paths                                                                   |
| `defaultTags`                | `group.service.ts:27` via `buildDefaultGroupTags`                                                        | seeds a new group's active tags                                                                                             |
| whole list                   | `groups/new/page.tsx:162`, `GroupSettingsView.tsx:438`                                                   | the theme picker                                                                                                            |

### 7.3 Design tokens and MUI palette augmentation

`src/lib/theme/tokens.ts` defines a `SemanticTokens` interface (`:9-42`) and two complete instances — `lightTokens` (`:44-72`) and `darkTokens` (`:74-102`). The interface is the contract: every semantic key exists in both modes, so a token can never be defined for one theme only. Roles are semantic, not visual: `positive` = mint = owed to you, `negative` = coral = you owe, plus `brand`/`info`/`warning`, six background/surface/border levels, four text levels, focus colour + ring, the `strip` gradient set, and two shadows. Shared structural constants live alongside: `FONT_UI`/`FONT_MONO` (bound to the `next/font` CSS variables set in `src/app/layout.tsx:7-17`), `NAV_HEIGHT = 56`, `SIDEBAR_WIDTH = 240`, `RADIUS = {sm:8, md:12, lg:16}` (`:109-115`).

`src/lib/theme/createAppTheme.ts` maps tokens onto MUI. It **augments** MUI's own types via `declare module '@mui/material/styles'` — adding `palette.surface`, `palette.border.strong`, `palette.tint.*`, `palette.strip.*`, `palette.focus.*` and a `typography.money` variant, with matching `PaletteOptions`/`TypographyVariantsOptions` so `createTheme` accepts them (`:4-52`). The theme then sets `primary/secondary/info/error/success/warning/background/text/divider` from tokens plus those custom slots (`:68-107`), overrides shadow indices 1–3 with the token shadows (`:61-65`), and adds global component defaults: 44 px minimum button/list-item height (touch targets), pill chips, a segmented-control look for `MuiTabs`/`MuiTab`, an explicit `:focus-visible` outline + ring, `panel-in`/`balance-settle` keyframes, and a `prefers-reduced-motion` kill-switch (`:125-270`).

Mode selection is a three-step dance in `src/providers/ThemeProvider.tsx`: state starts at a deterministic `'light'` so SSR and the first client render agree (`:38-42`), then a `requestAnimationFrame` adopts `localStorage['splitwise-theme-mode']` or `prefers-color-scheme` (`:44-49`), and an effect mirrors the mode onto `document.documentElement` as `style.colorScheme` and `data-theme` (`:59-62`). A tiny inline script in `<head>` applies the same attribute before paint to avoid a flash (`src/app/layout.tsx:33-37`). MUI is wired for the App Router with `AppRouterCacheProvider` from `@mui/material-nextjs/v15-appRouter` with `enableCssLayer: true` — the path and option MUI documents for the current version ([MUI Next.js integration](https://mui.com/material-ui/integrations/nextjs/)) (`src/providers/ThemeProvider.tsx:5,70`). The `data-theme` attribute is what the Playwright theme suite asserts against (`playwright/fixtures.ts:47-50`).

`MoneyText` is the enforced money treatment: monospace + tabular figures from `theme.typography.money`, with tone→colour mapping `positive→success.main`, `negative→error.main`, `neutral→text.primary` and an optional explicit sign (`src/components/common/MoneyText.tsx:16-52`, `src/lib/utils/money.ts:6-27`). The zero epsilon is 0.005 (`src/lib/utils/money.ts:6`) — but `BalancesView` re-implements the same comparison inline rather than calling `getMoneyTone` (`src/components/balances/BalancesView.tsx:336`).

### 7.4 Component tree

Route layer (all Server Components unless noted): `src/app/layout.tsx` (fonts, metadata, pre-paint theme script, `AuthProvider` → `ThemeProvider`) → `src/app/(main)/layout.tsx` (session guard, `Navbar` + `Sidebar` + main box) → thin page shells that `await auth()`, `await params`, and hand ids to a client view (`src/app/(main)/groups/[id]/page.tsx:5-11` is the archetype). Two routes break the pattern by being `'use client'` pages in their own right: `src/app/(main)/groups/new/page.tsx:1` (404 lines of group-creation form) and `src/app/(main)/settings/page.tsx:1` (155 lines of profile form). There is **no `error.tsx`, `loading.tsx`, `not-found.tsx` or `template.tsx` anywhere** under `src/app/`, and `src/app/(auth)/` has no layout.

```
app/layout.tsx (RSC)
└ AuthProvider → ThemeProvider (AppRouterCacheProvider → MUIThemeProvider → CssBaseline)
  ├ app/page.tsx (RSC)              → LandingPage → BrandMark
  │                                 └ DemoPersonaPicker → BrandMark, DemoModeBadge
  ├ app/(auth)/login/page.tsx (RSC, Suspense)
  │   ├ DemoLoginClient             → DemoPersonaPicker
  │   └ LoginForm                   → BrandMark
  ├ app/join/[code]/page.tsx (RSC)  → JoinGroupClient → BrandMark | DemoPersonaPicker
  └ app/(main)/layout.tsx (RSC — auth() + redirect)
    ├ Navbar (only useThemeMode consumer), Sidebar
    ├ dashboard/page.tsx (RSC)      → DashboardView
    │     ├ GroupCard ─┬ TripStrip            (theme.header === 'strip')
    │     │            ├ GroupHeader
    │     │            └ HouseholdMonthSpend   (theme.signature === 'monthCycle')
    │     ├ InvitationCard
    │     └ MoneyText
    ├ groups/page.tsx (RSC)         → GroupsListView → GroupCard(mode="management")
    ├ groups/new/page.tsx ('use client')
    ├ settings/page.tsx ('use client')
    ├ groups/[id]/page.tsx (RSC)    → GroupDetailView
    │     ├ TripStrip | GroupHeader
    │     ├ MonthCycleBar                      (signature === 'monthCycle')
    │     ├ MonthMemberTable
    │     ├ [tab 0] ExpenseListView → ExpenseCard, ExpenseFormDialog(edit), DeleteExpenseDialog
    │     ├ [tab 1] BalancesView    → SettleUpDialog
    │     ├ [tab 2] ActivityView
    │     ├ ExpenseFormDialog(create)
    │     └ InviteDialog
    └ groups/[id]/settings/page.tsx (RSC) → GroupSettingsView
          └ RecurringExpensesSection         (theme.recurringExpenses)
```

Two independent `ExpenseFormDialog` instances are mounted simultaneously on the group page — one for create (`src/components/groups/GroupDetailView.tsx:477`), one for edit (`src/components/expenses/ExpenseListView.tsx:633`) — each holding a full copy of the form state. `src/components/layout/BrandMark.tsx` is the only shared component without a `'use client'` directive, so it is the only one an RSC can render directly.

### 7.5 Where logic has leaked into components

Client views by size (`wc -l`):

| Component                             | Lines | Responsibility                                                                                            |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `expenses/ExpenseFormDialog.tsx`      | 1112  | create/edit expense: quick-picks, split UI for all five methods, multi-payer, duplicate pre-check, submit |
| `groups/GroupSettingsView.tsx`        | 957   | group edit, member roles, tag CRUD, theme change, recurring section host                                  |
| `groups/RecurringExpensesSection.tsx` | 798   | template list + create/edit dialog + pause/resume/delete                                                  |
| `expenses/ExpenseListView.tsx`        | 667   | filters, pagination, list, summary surfacing                                                              |
| `expenses/ExpenseCard.tsx`            | 569   | one expense row + inline detail                                                                           |
| `groups/GroupDetailView.tsx`          | 493   | tabs, header selection, month lens, checklist                                                             |
| `dashboard/DashboardView.tsx`         | 474   | buckets, next action, group cards, invitations                                                            |
| `balances/BalancesView.tsx`           | 372   | balances, "who pays whom", settle dialog, history                                                         |

Some logic has been extracted into pure, tested modules — `expense-form-helpers.ts` (default/selectable tags, advanced-split detection, category derivation), `expense-duplicate-check.ts` (URL building), `trip-setup.ts` (checklist), `activity-timeline.ts` (day grouping and copy), and correctly `settlement-authorization.ts`, which `BalancesView.tsx:248` consumes. What remains embedded:

- **`ExpenseFormDialog.tsx`** holds the only validation that split and payer amounts sum to the total (`:295-318`), the payload construction for all five methods (`:321-343`), and the duplicate-confirm UX (`:390-412`). None of the sum logic has a server counterpart. It also **re-implements the split arithmetic and disagrees with the server**: the preview is plain division, `parsedAmount / selectedMembers.length` (`:207`), whereas the stored value is floor-to-cents with the remainder on participant 0 (`src/lib/services/split-calculation.ts:29-34`) — so the per-person figure shown at `:899` can differ from what is persisted by a cent.
- **`RecurringExpensesSection.tsx`** contains a _second, independent_ statement of the sum rules — percentages to 100 ± 0.01 and exact amounts to the total ± 0.01 (`:213-227`) — alongside a client-side restatement of the server's problem-state detection (`:172-183`) that omits the currency arm (`src/lib/services/recurring-expense.service.ts:66`). Its `SPLIT_METHOD_OPTIONS` offers only four of the five methods (no `unequal`, `:78-83`) while three code paths still branch on `'unequal'` (`:221,244,661`).
- **`MonthCycleBar.tsx`** exports both the `ActiveMonthRange` domain type (`:23-38`) and `parseMonthParam` (`:46-66`) — the URL⇄time-range contract, viewer-local ISO bounds, and the "cannot step past the current month" rule (`:102`) — from a presentational component module, which `GroupDetailView` imports back out to drive fetching (`:25,174`). It has **no unit test** (§9.4). Its month-stepping anchors on day 2 to dodge a timezone rollover, undocumented, inside a click handler (`:98`).
- **`GroupDetailView.tsx`** derives the past-month expense-date default and the "Settle {Month}?" nudge inline, with comments citing spec clauses ("Amendment B", "Amendment D") rather than a named module (`:183-192`).
- **`ExpenseListView.tsx`** owns the custom-date-range rules — start before end, **max 31 days** (`:99-109`) — which exist nowhere on the server, and which silently disable fetching via `shouldFetch` (`:130`). It also groups expenses by the _display string_ `formatDate(expense.date)` (`:157-162`), so grouping identity is coupled to the copy `'Today'`/`'Yesterday'` (`src/lib/utils/date.ts:20-22`).
- **`GroupSettingsView.tsx`** performs the admin authorization check in the view — `isAdmin` and an "Access denied" early return (`:150-169`) — while the page shell does not check at all (`src/app/(main)/groups/[id]/settings/page.tsx`). It also hard-codes `expiresInDays: 7` (`:263`), duplicated at `src/components/groups/InviteDialog.tsx:74`, and navigates with `window.location.href` rather than the router after archiving (`:288`).
- **Epsilon and formatting duplication.** `BalancesView.tsx:336` and `DashboardView.tsx:205,218` inline `0.005` comparisons instead of `MONEY_ZERO_EPSILON`/`getMoneyTone` (`src/lib/utils/money.ts:6,12`); `BalancesView.tsx:208-212` branches on raw `> 0`/`< 0` with no epsilon at all. `ExpenseCard.tsx:27-38` duplicates the ten category icons that `src/lib/constants/categories.ts:7-18` already exports (and that `ExpenseListView.tsx:354-356` uses properly), and `ExpenseCard.tsx:92-94` recomputes `split − paid` per card, the same formula as `computeUserOweGetBack` (`src/lib/services/expense-summary.ts:90-104`).
- **`DashboardView.tsx`** defines the greeting policy (`:30-35`) and the "recent groups" rule — sort by `updatedAt`, take 3 (`:70-72`) — in the view, while its sibling rule `selectNextAction` lives correctly in `src/lib/utils/dashboard.ts:35`. The `kind → button label` map is in JSX (`:310-316`) while `kind → title/description/href` is in the util: one decision, two files.

---

## 8. Client data fetching

Nearly all fetching is SWR against the app's own API; no page component fetches data server-side beyond `auth()`. Three screens opt out and use raw `fetch`: `src/app/(main)/settings/page.tsx:26-36` (profile load in a `useEffect`), `src/components/join/JoinGroupClient.tsx:39,58` (invite preview and join), and `src/components/groups/InviteDialog.tsx:46,71`.

`src/lib/utils/fetcher.ts:1-8` is eight lines: `fetch(url)` → `res.json().catch(() => ({}))` → on `!res.ok` throw `new Error(json.error || res.statusText || 'Request failed')` → else return the raw envelope. Consumers therefore always read `data?.data?.…`. The thrown `Error` carries **no status code**, so every error UI in the app can only surface `error.message` (`ActivityView.tsx:55`, `GroupsListView.tsx:39`, `GroupDetailView.tsx:123`, `GroupSettingsView.tsx:124`, `ExpenseListView.tsx:200`, `BalancesView.tsx:97`, `DashboardView.tsx:167,344,421`) — a 403 and a 500 are indistinguishable to the UI.

| Component                          | Key                                                                   | Options                                             |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `DashboardView.tsx:48,54,60`       | `/api/groups`, `/api/user/balances`, `/api/invitations`               | `refreshInterval: 30_000`                           |
| `GroupsListView.tsx:21-22`         | `/api/groups`                                                         | `refreshInterval: 30_000`                           |
| `GroupDetailView.tsx:69,73,77`     | `/api/groups/{id}`, `…/expenses?page=1&limit=1`, `…/balances`         | `refreshInterval: 30_000`                           |
| `ExpenseListView.tsx:132-136`      | `…/expenses?<filters>` **or `null`** when the custom range is invalid | `refreshInterval: 10_000`, `keepPreviousData: true` |
| `ActivityView.tsx:33-38`           | `…/activity?page=1&limit=50`                                          | `refreshInterval: 10_000`                           |
| `BalancesView.tsx:67-68`           | `…/balances`                                                          | `refreshInterval: 15_000`                           |
| `BalancesView.tsx:74`              | `…/settlements`                                                       | defaults                                            |
| `GroupCard.tsx:48`                 | `…/expenses?<current-month params>` (inside `HouseholdMonthSpend`)    | defaults                                            |
| `GroupSettingsView.tsx:56`         | `/api/groups/{id}`                                                    | defaults                                            |
| `RecurringExpensesSection.tsx:149` | `…/recurring`                                                         | defaults                                            |

There is **no `<SWRConfig>` provider anywhere**, so SWR's documented defaults apply unmodified: `refreshInterval: 0`, `revalidateOnFocus: true`, `revalidateOnReconnect: true`, `dedupingInterval: 2000`, `keepPreviousData: false`, `revalidateIfStale: true` ([SWR API options](https://swr.vercel.app/docs/api)). A mounted group-detail page therefore runs four independent polls (detail, one-row expense probe, balances, plus the list's own 10 s poll), two of which trigger server-side recurring generation (§5.4). `ActivityView` requests `limit=50` and never paginates, so the API's own default of 20 (`src/app/api/groups/[id]/activity/route.ts:24`) is never exercised by the app.

**Key collisions matter here.** `/api/groups` is fetched by both `DashboardView.tsx:48` and `GroupsListView.tsx:21`; `/api/groups/{id}` by both `GroupDetailView.tsx:69` and `GroupSettingsView.tsx:56`; and `…/balances` by `GroupDetailView.tsx:77` with `refreshInterval: 30_000` **and** `BalancesView.tsx:67` with `15_000`. SWR keys the cache and its timers by the key string, so when both are mounted the effective polling interval for balances depends on mount order rather than on either declaration.

**Nothing is optimistic.** Every `mutate` call in the repo is a bare revalidation — no second `data` argument, and no `optimisticData` / `rollbackOnError` / `populateCache` / `revalidate: false` options anywhere: `DashboardView.tsx:162,339,416,431`, `ExpenseListView.tsx:165,178`, `BalancesView.tsx:366-367`, `GroupSettingsView.tsx:191,211,238,323,343,370`, `RecurringExpensesSection.tsx:290,311,333`. Two calls use a **key-filter function** against the global `mutate` from `useSWRConfig`: `ExpenseFormDialog.tsx:430` invalidates every key beginning `/api/groups/{groupId}` (which is how one expense write refreshes the list, the balances and the header at once), and `GroupSettingsView.tsx:192` invalidates every key merely _containing_ `/api/groups` — i.e. every group's cached data app-wide, after a name/description edit.

Because there is no optimistic layer, post-write latency is a full round-trip plus a re-render, and a failed write surfaces as a stale-then-corrected view rather than a rollback. Several writes revalidate nothing at all: `InviteDialog.tsx:46,71`, `src/app/(main)/settings/page.tsx:41`, and `src/components/join/JoinGroupClient.tsx:58`.

---

## 9. Testing

Three layers, ~250 assertions across 39 files.

### 9.1 Unit (Vitest, `environment: 'node'`)

28 non-integration `*.test.ts` files under `src/`. All pure-function or mock-based; there are **no component tests** — `vitest.config.ts:7` includes only `src/**/*.test.ts`, so a `.tsx` test would not even be collected, and no React testing library is installed. The heaviest suites are `recurring-due-periods.test.ts` (22 cases), `split-calculation.test.ts` (15), `expense-validation.test.ts` (15), `auth.config.test.ts` (12), `debt-simplifier.test.ts` (12).

`balance.service.test.ts` is the one unit test of a DB-touching service, and it works by `vi.mock`-ing `@/lib/db` and all four models (`:7-32`) — it therefore pins the _currency-bucketing shape_ of the service's output but proves nothing about the queries.

### 9.2 Integration (Vitest against a real MongoDB)

Eight `*.integration.test.ts` files. The isolation mechanism is `src/lib/test-utils/integration-db.ts`:

- Each file calls `integrationTestDb('<key>')`, which slugs the key and builds the database name `splitwise-test-<key>` (`:57-62`).
- The base URI comes from `TEST_MONGODB_URI` or defaults to `mongodb://127.0.0.1:27017/?directConnection=true`; **any** database segment in it is replaced by the per-file name via `new URL().pathname` (`:37-41,63-64`).
- `assertSafeTestDatabase` hard-fails unless the name starts with `splitwise-test-`, and hard-fails if _either_ the name or the full URI matches `/demo|prod|live|stage/i` (`:20-22,43-55`). This is the repo's only structural production guard, and it is checked on both the derived name and the operator-supplied URI.
- `connect()` **mutates `process.env.MONGODB_URI`** and then calls the app's own `connectDB()` (`:71-74`) — the tests exercise the real connection module, not a stub. `reset()` deletes all documents but keeps indexes; `teardown()` drops the database and disconnects (`:75-85`).

Per-file databases are what allow Vitest to run files in parallel without clobbering; each suite pairs `beforeEach(db.reset)` with shared fixture users under a distinct `b…` ObjectId prefix so they never collide with the `a…` demo personas (`src/lib/test-utils/fixtures.ts:10-15`). `integration-db.test.ts` is itself a unit test of the naming and guard rules (`:5-31`).

**The `server-only` stub.** `src/lib/db.ts:1` and `src/lib/mongodb-client.ts:5` import `server-only`, whose real implementation throws unless the bundler sets the `react-server` export condition. Vitest runs plain Node, so `vitest.config.ts:16` aliases the specifier to `src/lib/test-utils/stubs/server-only.ts` — a file whose entire body is `export {}` (`:1-4`). Without that alias every integration test would fail at import time.

### 9.3 Browser (Playwright)

Two suites, both fully serial (`workers: 1`) because they share one mutable database.

- **Demo suite** (`playwright/`, port 3100): `globalSetup` shells out to `pnpm run demo:reset` with `MONGODB_URI` pinned to `splitwise-demo`, so every run starts from the same seeded baseline (`playwright/global-setup.ts:10-17`). Four projects (desktop/mobile × light/dark) driven purely by `colorScheme` emulation. `demo-journeys.spec.ts` walks six journeys — enter as Alex → create a trip → add → edit → switch to Sam and settle → verify Priya's balance — including hard-coded seeded amounts (`₹6,160.00`, `₹4,680.00`). `theme-a11y.spec.ts` runs the four visual/a11y checks per project: persona entry, dashboard, trip workspace, and the theme-toggle persistence round-trip. Fixtures provide `enterAsPersona`, `signOut`, `expectThemeApplied` (polls `document.documentElement.dataset.theme`), `reviewScreenshot`, `parseMoneyText`, and an axe scan that **fails only on `critical` impact** while attaching the full violation list to the report (`playwright/fixtures.ts:18-106`).
- **Google suite** (`playwright-google/`, port 3101): four tests that never complete a real OAuth flow. They assert the landing and `/login` show the Google button and _not_ the demo picker, that `/dashboard` redirects anonymous users to `/login?callbackUrl=%2Fdashboard`, and — by intercepting `https://accounts.google.com/**` — that the authorize URL carries the configured `client_id`, the `/api/auth/callback/google` redirect URI, `response_type=code`, an `openid` scope and `code_challenge_method=S256` (`playwright-google/google-auth.spec.ts:11-65`).

### 9.4 Honest coverage read

**Genuinely pinned by tests:**

- Every branch of `calculateSplitAmounts`, including the remainder-to-index-0 rule, the sub-cent case, the zero-shares no-op, and the acknowledged cent drift on `shares`/`percentage` (`split-calculation.test.ts:9-177`).
- Zero-sum of `calculateNetBalances` across mixed methods and settlements, and `simplifyDebts` collapsing three-person nets (`debt-simplifier.test.ts:124-155,170-188`), corroborated end-to-end against a real database (`balance-integrity.integration.test.ts:71-176`).
- The full recurring contract: concurrent generation producing exactly one expense, sequential idempotence, missed-month catch-up, pause/resume skipping the on-hold window, visible-skip-then-catch-up on an archived tag, the first-month `startsOn` clamp, template deletion leaving expenses intact, group scoping, and generated expenses flowing through the month breakdown (`recurring-expense.integration.test.ts:90-380`), plus 22 pure scheduler cases (`recurring-due-periods.test.ts`).
- Membership, admin boundaries, last-admin protection, self-removal, and invite-code membership gating (`group.service.integration.test.ts:39-190`).
- Expense invariants against a real DB: non-member payers and split participants rejected, single-currency enforced, archived tags rejected on create but preserved on unchanged edit, edit history, soft-delete/restore, duplicate detection excluding self (`expense-settlement.integration.test.ts:56-273`).
- Settlement authorization, including a third member being refused (`expense-settlement.integration.test.ts:309`).
- Invitation ownership by email in both directions, expiry, and idempotent membership (`invitation.service.integration.test.ts:38-166`).
- The `dateTo` end-of-day widening and its non-application to full ISO timestamps (`expense-date-filter.integration.test.ts:56-96`).
- `byMember` summing to zero and including zero rows for inactive members (`expense-member-breakdown.integration.test.ts:70-177`).
- Currency bucketing on the dashboard, including the archived-group exclusion and the mixed-currency flag (`balance-integrity.integration.test.ts:176-258`, `dashboard.test.ts:15-101`).
- Auth: the fail-closed matrix, persona allowlisting, provider registration, and every branch of the `authorized` callback as a _pure function_ (`auth-mode.test.ts`, `demo-personas.test.ts`, `auth.config.test.ts`).
- Demo seed idempotence and exact persona balances (`seed.integration.test.ts:30-143`).
- The test-database naming guard itself (`integration-db.test.ts:5-31`).

**Not pinned by any test:**

- **That split amounts sum to the expense total.** No test asserts a rejection, because the server does not reject. Both client-side statements of the rule (`ExpenseFormDialog.tsx:295-318`, `RecurringExpensesSection.tsx:213-227`) are untested, as is the equal-split preview that disagrees with the server (`ExpenseFormDialog.tsx:207`).
- **That expense-by-id routes are scoped to the group in the URL.** No test crosses group boundaries on `/groups/[id]/expenses/[expenseId]` (the recurring suite tests group scoping only for templates, `recurring-expense.integration.test.ts:342`).
- **What NextAuth actually does with a `false` return.** `auth.config.test.ts` calls the callback directly and asserts the return value; the middleware's translation of `false` into a redirect is never exercised for API paths.
- **`MonthCycleBar.parseMonthParam`** — the month-range derivation, timezone bounds, and forward cap. Zero unit tests; only indirectly touched by the E2E suite.
- **Any React component**, by construction (§9.1).
- **The group-balance mixed-currency summation.** `balance.service.test.ts:41` asserts the _flag_ is raised; nothing asserts what the summed number means.
- **Rate limiting, pagination bounds, `limit` ceilings** — none exist, none are tested.
- **The `{description: 'text'}` index** and `alternateCurrencies` — both dead.
- **Route handlers themselves.** Every test targets services or pure functions; no test invokes an exported `GET`/`POST` route function, so response envelopes, status codes and error mappings are verified only through the browser suite.

---

## 10. Currency handling

**The rule: one currency per group.** `Group.defaultCurrency` is required (`src/lib/models/Group.ts:65`) and validated against a fixed 30-code list at the API boundary (`src/lib/validators/group.validator.ts:32-34`; `src/lib/utils/currency.ts:8-41`). Enforcement is a single assertion, `assertGroupCurrency(defaultCurrency, currency)`, which throws `CURRENCY_MISMATCH` on any inequality (`src/lib/services/expense-validation.ts:59-63`). It is called on:

- expense create (`src/lib/services/expense.service.ts:41`)
- expense update, whenever `currency` is present in the patch (`:284-286`)
- settlement create (`src/lib/services/settlement.service.ts:28`)
- recurring template create and update (`src/lib/services/recurring-expense.service.ts:66,158-160`)
- every recurring generation, via `assertTemplateData` (`:254`)

Routes map it to **422** with "Currency must match the group default currency" (`src/app/api/groups/[id]/expenses/route.ts:19,41-43` and the settlement/recurring equivalents). `Group.alternateCurrencies` is still modelled, validated (≤2) and accepted by the API (`src/lib/models/Group.ts:66-73`; `src/lib/validators/group.validator.ts:35-38`), and `getSortedCurrencies` still sorts by it (`src/lib/utils/currency.ts:63-73`) — but no write path consults it, so declaring an alternate currency does not permit using it. It is inert.

**Formatting** is `Intl.NumberFormat('en-US', {style:'currency', currency, min/maxFractionDigits: 2})` with a `CODE 0.00` fallback on unknown codes (`src/lib/utils/currency.ts:47-58`). Note the fixed `en-US` locale: grouping and symbol placement follow US conventions regardless of the currency or the viewer.

**How the dashboard buckets without summing across currencies.** Three layers keep the arithmetic separated:

1. `getUserBalances` computes the set of currencies actually present per group and `flatMap`s over it, running an _independent_ `calculateNetBalances` + `simplifyDebts` on each currency's slice (`src/lib/services/balance.service.ts:134-201`). A currency in which the user nets under 0.01 is dropped (`:171`).
2. Each result is emitted as `{currency, balance, settlement?}` — the currency travels with the number (`:186-200`), typed as `DashboardBalanceAmount` (`src/types/index.ts:254-258`).
3. `aggregateCurrencyBalances` keys a `Map` by currency code and only ever adds into the bucket for that code (`src/lib/utils/dashboard.ts:11-30`). The output is a sorted array of `{currency, youOwe, youAreOwed, net}` (`src/types/index.ts:269-274`). Cross-currency addition is structurally impossible here.

`selectNextAction` likewise carries `currency` on the settle CTA rather than comparing amounts across currencies — though its "largest payable debt" comparison **does** sort raw amounts across different currencies (`src/lib/utils/dashboard.ts:54-58`), so with mixed-currency groups the "biggest" debt is whichever has the biggest number, not the biggest value.

**The asymmetry.** `getGroupBalances` does **not** do any of this. It drops the currency field during projection (`src/lib/services/balance.service.ts:30-45`), folds everything into one number, labels the result with `group.defaultCurrency` (`:87`), and raises `hasMixedCurrencies` if any row differs (`:25-27`). The UI shows a warning banner (`src/components/balances/BalancesView.tsx:175,192`) but still renders the summed figure. Since the write path now makes mixed data impossible, this only bites on legacy documents — which is exactly what the integration test is named for (`balance-integrity.integration.test.ts:213`, "flags legacy mixed-currency data but still buckets it separately" — the _bucketing_ claim in that title applies to the dashboard, not to the group endpoint). Note also the two endpoints define the flag differently: "differs from the group default" vs "more than one currency present" (`:25-27` vs `:208`).

---

## 11. Discrepancies between the repo's docs and the code

Every item was confirmed by reading both sides. Ranked by how badly it would mislead a reader. `docs/v3/tag-management.md`, `docs/v4/README.md` §Phase 3, and `docs/auth.md` §1 are the docs that _do_ match the code; treat the rest with suspicion.

### 11.1 Docs that would make you write broken code

1. **Expenses have one required `tag` string, not a `tags` array.** `docs/api.md:226` shows `"tags": ["dinner", "birthday"]` in the POST body and `docs/api.md:248` documents `&tags=dinner,birthday // comma-separated`; `docs/database.md:101` declares `tags: [string]` and `:128` an index `{ group: 1, tags: 1 }`; `docs/pages/add-expense.md:82` lists a `tags` chip input. The code has `tag: { type: String, required: true }` (`src/lib/models/Expense.ts:111`) with index `{group: 1, tag: 1}` (`:131`), a single required `tag` in the schema (`src/lib/validators/expense.validator.ts:32`), and reads only `tag` from the query string (`src/app/api/groups/[id]/expenses/route.ts:71`). A doc-shaped POST fails with 422. The docs also never mention that the tag must be an **active group tag** (`src/lib/services/expense-validation.ts:28-32`).
2. **`GET /api/groups/[id]/balances/simplified` does not exist.** `docs/api.md:301` and `docs/features/balances.md:131` document it as returning "minimized transactions" distinct from the plain balances endpoint. No such route file exists, and the distinction is fictional in both directions: the single `/balances` endpoint already returns simplified debts (`src/lib/services/balance.service.ts:77-82`).
3. **Receipt upload does not exist.** `docs/api.md:379-380` documents `POST`/`DELETE /api/groups/[id]/expenses/[expenseId]/receipt`; `docs/features/receipts.md:85` shows a multipart contract; `docs/v2/receipt-upload.md:18` names `POST /api/upload/receipt`. No route, no upload component, no storage integration. Worse, `receiptUrl` is absent from both `createExpenseSchema` and `updateExpenseSchema` (`src/lib/validators/expense.validator.ts:5-39`) — and Zod [strips unrecognized keys by default](https://zod.dev/api?id=objects) — so **no API path can ever write it**, while `src/components/expenses/ExpenseCard.tsx:304` renders a receipt chip that is therefore unreachable.
4. **Expense and settlement currency is hard-locked to the group default.** `docs/features/expenses.md:228` states "Expense currency doesn't have to match group default (any currency allowed…)"; `docs/features/currency.md:14` says a user "can still select any currency for an expense"; `docs/features/settlements.md:191` says mismatches "warn but allow". The code throws `CURRENCY_MISMATCH` → **HTTP 422** on any inequality, for expenses (`src/lib/services/expense.service.ts:41,285`), settlements (`src/lib/services/settlement.service.ts:28`) and recurring templates (`src/lib/services/recurring-expense.service.ts:66,158`). The entire multi-currency narrative in `docs/features/currency.md:118-134` describes behaviour the write path forbids (§10).
5. **The permission matrix is wrong, in the permissive direction.** `docs/features/groups.md:95-96` claims "Edit others' expense — Admin ✅ / Member ❌" and the same for delete. Neither route nor service checks creator or role: `src/app/api/groups/[id]/expenses/[expenseId]/route.ts:55,86` call only `isMember`, and `expenseService.update`/`delete` (`src/lib/services/expense.service.ts:244,334`) never look at who created the expense. `docs/v2/edit-expense.md:110` is the accurate doc ("Future: optionally restrict edits to creator + admins only"). Security-relevant, and it compounds with §12 risk 1.
6. **`GET /api/groups` has no query params and no `totalBalance`.** `docs/api.md:89` documents `?archived=false`; the handler is `export async function GET()` with no `Request` parameter at all, so no query string can ever be read (`src/app/api/groups/route.ts:29`). `docs/api.md:108` shows a `"totalBalance": 150.0` field that `getUserGroups` never produces (`src/lib/services/group.service.ts:41-55`). `docs/pages/dashboard.md:81`'s archived-groups toggle has no implementation either.
7. **`docs/ui.md` describes a theme that no longer exists.** `docs/ui.md:11` locates the theme in `src/providers/ThemeProvider.tsx`; `:16-24` gives the palette as `#6C63FF / #00BFA5 / #FF5252 / #F5F5F5 / #1A1A2E`; `:56` names `var(--font-geist-sans)`; the whole file assumes a single light theme. Reality: the theme is built in `src/lib/theme/createAppTheme.ts:58` from semantic tokens (`src/lib/theme/tokens.ts`), brand is `#3d4fcf` light / `#7b8cff` dark (`:46,76`), background `#f4f5f9`, there is a complete dark token set (`:74-102`), and the fonts are Outfit + IBM Plex Mono (`src/app/layout.tsx:2`, `src/lib/theme/tokens.ts:109-110`). Every hex value and the font name are wrong.
8. **`docs/auth.md` §2 contradicts itself and the code.** `docs/auth.md:100-136` presents `src/lib/auth.ts` as holding `providers`, `session`, `callbacks` and `pages`. The real file is 14 lines and holds only the adapter wiring (`src/lib/auth.ts:11-14`); everything else lives in `src/lib/auth.config.ts:15-97`, including the demo Credentials provider the passage omits — which the _same doc_ states correctly at `:5`. (Its auth-mode table at `:12-17` does match `src/lib/auth-mode.ts:18-31`.)

### 11.2 Docs describing components, hooks and routes that do not exist

9. **A hooks layer that was never built.** `docs/features/dashboard.md:155-183` documents `useExpenseFilters`; `docs/features/realtime.md:37-60` documents `useExpenses`/`useBalances`/`useActivity`. There is no `src/hooks` directory; filters are local state in `ExpenseListView`. `docs/architecture.md:234` gets this right ("SWR used directly in components (no custom hooks layer)"), so the docs contradict each other.
10. **Components documented but absent:** `ExpenseDetailDialog` (`docs/architecture.md:104`, `docs/ui.md:185`), plus `AvatarStack`, `ExpenseDashboard`, `BalanceSummary`, `SimplifiedDebts`, `ActivityFeed`, `InviteCard`, `EmptyState` (`docs/pages/group-detail.md:148-152`, `docs/pages/dashboard.md:117-121`) and `CurrencySelect`, `ReceiptUpload`, `PredefinedItemPicker` (`docs/pages/add-expense.md:222-224`). The real components are listed in §7.4.
11. **A mobile route that does not exist.** `docs/pages/add-expense.md:3,208` describes `/groups/[id]/expenses/new`; no such directory exists under `src/app`, and the form is always `ExpenseFormDialog`.
12. **Server-component dashboard.** `docs/pages/dashboard.md:96` shows a server component calling `invitationService.getPendingInvitations(...)` inside `Promise.all`. The method is named `getPendingByEmail` (`src/lib/services/invitation.service.ts:52`), and `DashboardView` is a client component driven by three SWR hooks (`src/components/dashboard/DashboardView.tsx:48-60`).
13. **Activity "Load More" does not exist.** `docs/features/activity-feed.md:125-126` and `docs/pages/group-detail.md:84` describe 20-per-page with a Load More button; `src/components/activity/ActivityView.tsx:34` fetches `?page=1&limit=50` once and renders it, with no pagination control.
14. **`docs/features/realtime.md:63-116` documents optimistic updates and a "new data" notification.** Neither exists — no `optimisticData` anywhere in the repo (§8). Its refresh-interval table at `:186-194` _is_ accurate.
15. **`docs/pages/login.md:10` says "Single option: Google OAuth".** Demo-persona sign-in exists and is a first-class mode (`src/components/auth/DemoLoginClient.tsx`, `src/lib/auth.config.ts:16-29`), as `docs/auth.md` and the README correctly describe.

### 11.3 Schema and contract drift

16. **The whole recurring-expense subsystem is missing from the core docs.** Four routes, a model, a validator and a service exist (`src/app/api/groups/[id]/recurring/**`, `src/lib/models/RecurringExpense.ts`, `src/lib/services/recurring-expense.service.ts`) and are admin-gated and Household-only. `docs/api.md` has no section, `docs/architecture.md:41-81`'s file tree omits all of it (and also omits `api/user/balances/`), and `docs/database.md` has no `RecurringExpense` collection. Only `docs/v4/README.md` §Phase 3 covers it.
17. **`docs/database.md`'s Group schema omits three persisted fields:** `tags` (`src/lib/models/Group.ts:64` — the entire tag system), `startDate` and `endDate` (`:79-80`). It also calls the invite-code index "unique sparse (only when set)" (`docs/database.md:61`) where the code uses a **partial** index and carries a comment explaining precisely why sparse would collide on explicit nulls (`src/lib/models/Group.ts:93-98`).
18. **`docs/database.md`'s Expense schema omits `recurringExpense` and `period`** (`src/lib/models/Expense.ts:115-116`) and the unique partial index on them (`:137-140`), and describes `amount` as "positive number" where the schema enforces `min: 0.01, max: 10_000_000` (`:86`).
19. **`docs/database.md:99` asserts the invariant "splitBetween amounts must sum to `amount`" as a schema comment.** Nothing enforces it — not the schema, not Zod, not the service (§4.1, §12 risk 2). This is the single most consequential doc claim that the code does not honour.
20. **Activity metadata contract overstates what is stored.** `docs/database.md:183-184` documents `member_joined: { userId, userName, method }` and `member_left: { userId, userName }`; the code never writes `userName` — `src/lib/services/group.service.ts:161-164,253-256` log `{userId, method}`, and `src/lib/services/invitation.service.ts:104-106` logs only `{method: 'invite'}` with no `userId`. `docs/features/activity-feed.md:143`'s "metadata is denormalized (stores names inline)" is false for member events.
21. **`docs/api.md`'s expense-list contract omits half of what exists:** no `paidByUser`, `owedByUser` or `includeMemberBreakdown` params (all parsed at `src/app/api/groups/[id]/expenses/route.ts:73-79`), and the documented response has only `expenses` + `pagination` where the service also returns `summary` (`src/lib/services/expense.service.ts:210-225`). `docs/v3/expense-summary.md:40` conversely shows a `summary.currency` field that is not returned.
22. **Status tables are stale in both roadmap docs.** `docs/v3/README.md:9-15` marks all seven v3 features "Pending" — all are shipped (tag CRUD routes, the settings page, the summary bar at `expense.service.ts:218`, inline expandable detail in `ExpenseCard`, `keepPreviousData` at `ExpenseListView.tsx:135`). `docs/v4/README.md:22,192-198` marks Phase 2 "Pending" with unchecked boxes — `MonthCycleBar` and `MonthMemberTable` exist and are wired (`GroupDetailView.tsx:276,373`), `includeMemberBreakdown` is implemented, and the inclusive-`dateTo` fix landed as `toInclusiveDateToBound`. Because `docs/v3/README.md` marks `tag-management.md` "Pending", a reader is actively steered away from the one doc that describes the real tag model.
23. **Undocumented but enforced; documented but unenforced.** `docs/api.md:281-292` omits the optional `paidBy` field on settlements (`src/lib/validators/settlement.validator.ts:6`) and never mentions that only the payer or recipient may record one (422 `FORBIDDEN_SETTLEMENT`). `docs/api.md:139` documents only `POST /api/join/[code]`, silently omitting the deliberately public `GET` (`src/app/api/join/[code]/route.ts:41`) — an unmarked exception to its own "auth required unless 🔓" rule at `:3`. Conversely, none of `docs/features/invitations.md:99-104`'s "cannot invite an existing member" and "max 20 pending invitations", nor `docs/features/groups.md:113-117`'s "group name unique per user", "max 50 members", "cannot archive with unsettled balances" and "creator cannot leave", exist in code — there is no leave-group endpoint at all. `docs/features/currency.md:154`'s "alternate currencies must be distinct" is likewise unvalidated (`src/lib/validators/group.validator.ts:35-38`).
24. **`docs/architecture.md:246-263`'s env block lists `CLOUDINARY_CLOUD_NAME`/`API_KEY`/`API_SECRET`** — referenced nowhere in code or `.env.example` — and omits `AUTH_MODE`, `ALLOW_DEMO_AUTH` and `TEST_MONGODB_URI`, which `.env.example:7-15` does define. Its "every API route follows this pattern" sample (`:198`) uses synchronous `params: { id: string }` and a bare `auth()`; real routes use `params: Promise<{...}>` and `getAuthUser()` (`src/app/api/groups/[id]/route.ts:15-18`).
25. **`docs/testing.md:96-98` omits `pnpm test:e2e:google` from the CI description** (it runs at `.github/workflows/ci.yml:94-95`), and its integration-test list at `:39-52` omits `recurring-expense`, `expense-date-filter` and `expense-member-breakdown`.
26. **`docs/features/expenses.md:135-153`'s predefined-items table** lists lowercase multi-tags ("rent, monthly"); the code has one capitalized `defaultTag` per item (`src/lib/constants/predefined-items.ts:5`) and an extra "Bus" entry. Its category list at `:166-177` matches `src/lib/constants/categories.ts` exactly.

### 11.4 Code that contradicts its own comments and neighbours

27. **`auth.config.ts:81` / `auth.config.test.ts:68` — "returns false → 401".** The comment and test name both assert a 401 from middleware; next-auth converts `false` into a redirect to the sign-in page with a `callbackUrl` ([`packages/next-auth/src/lib/index.ts`](https://github.com/nextauthjs/next-auth/blob/main/packages/next-auth/src/lib/index.ts)). The test passes because it checks only the callback's return value (§6.5).
28. **`src/lib/models/Expense.ts:142-143` (and `Group.ts:100-101`, `RecurringExpense.ts:94-95`) — "In development, …".** The `deleteModel` + re-register block has no `NODE_ENV` guard and runs everywhere; the comment describes an intent the code does not implement. The four other models use the conventional `mongoose.models.X ||` guard instead (§3.1).
29. **`src/lib/validators/expense.validator.ts:3` imports `CATEGORY_IDS` and never uses it.** `category` is `z.string().default('other')` (`:11`), so arbitrary category strings are accepted — contradicting `CONTEXT.md:11-13`. The dead import is the fossil of the intended check.
30. **`Group.category` defaults differently in the model and the validator:** `'other'` in the schema (`src/lib/models/Group.ts:77`) versus `'trip'` in `createGroupSchema` (`src/lib/validators/group.validator.ts:31`). API-created groups get `trip`; anything constructed directly gets `other`.
31. **`src/lib/models/Expense.ts:133` declares a `{description: 'text'}` index nothing uses** — search is `$regex` with `$options: 'i'` (`src/lib/services/expense.service.ts:120`), which cannot use a text index.
32. **`Group.alternateCurrencies` is modelled, validated (≤2) and API-accepted but inert** — no read or write path consults it (§10).
33. **`src/lib/services/expense-summary.ts:50-54` claims `sum(paid) === sum(share) === window total`** "because the service asserts membership at write time". Membership is asserted; amount conservation is not (§4.1).
34. **`playwright.google.config.ts:62` points the Google suite at the same `splitwise-demo` database** as the demo suite, with no global setup — so the two Playwright suites are not database-isolated from each other, contrary to the framing in `playwright.config.ts:5-13`. In practice nothing is written, because no OAuth flow completes.
35. **`eslint.config.mjs:15-16` ignores `.worktrees/**`** with the comment "Local feature worktrees are checked out copies of this repo". The worktrees this repo actually creates live at `.claude/worktrees/…`, which that pattern does not match.
36. **A doc claim that _does_ hold, worth recording:** `.github/workflows/ci.yml:39-40` states integration suites "derive per-file `splitwise-test-*` databases from this base URI; the demo database is never touched" — verified against `src/lib/test-utils/integration-db.ts:43-64`.

---

## 12. Risks and sharp edges, ranked by consequence

### Tier 1 — correctness or authorization defects

1. **Expense mutation is under-authorized on two axes.**
   _Across groups (IDOR):_ `GET`/`PATCH`/`DELETE /api/groups/[id]/expenses/[expenseId]` verify membership of `params.id` (`src/app/api/groups/[id]/expenses/[expenseId]/route.ts:32,55,86`) but the service resolves the expense by `_id` alone — `getById` (`src/lib/services/expense.service.ts:233`), `update` (`:247`), `delete` (`:337`). A member of _any_ group can read, edit or soft-delete _any_ expense in the database by supplying its id under a group they do belong to. `update` re-derives the group from the expense itself (`:250`), so its member/tag/currency checks validate against the **victim's** group, not the attacker's; `delete` performs no group check at all. Contrast the recurring routes, which scope correctly with `findOne({_id, group})` (`src/lib/services/recurring-expense.service.ts:139,199`).
   _Within a group:_ no route or service checks creator or admin role, so any member can edit or delete any other member's expense — contradicting the permission matrix in `docs/features/groups.md:95-96` (§11.1 item 5).
2. **No server-side conservation of money.** Nothing checks `sum(paidBy.amount) == amount` or `sum(splitBetween.amount) == amount`. Zod allows any non-negative numbers (`src/lib/validators/expense.validator.ts:13-31`); the schema allows any non-negative numbers (`src/lib/models/Expense.ts:52,60`); `calculateSplitAmounts` passes `unequal`/`exact` through untouched (`src/lib/services/split-calculation.ts:56`); the only check is in the dialog (`src/components/expenses/ExpenseFormDialog.tsx:295-318`). A direct API call can permanently break the group's zero-sum property, and since balances are derived rather than stored, every subsequent balance read inherits the corruption. Percentages summing to something other than 100 are equally unchecked.
3. **Recurring generation depends on an index that may not exist yet.** The idempotency argument (§5.3) rests entirely on the partial unique index. It is created by Mongoose `autoIndex` at model registration, which is asynchronous and unawaited ([Mongoose guide](https://mongoosejs.com/docs/guide.html)); the test suite compensates with an explicit `Expense.createIndexes()` (`src/lib/services/recurring-expense.integration.test.ts:49-52`), production does not. A first-deploy month-boundary burst against a collection whose index has not finished building can duplicate rent for every reader that raced.
4. **Writes in GET handlers.** `generateDueExpenses` runs on `GET /api/groups/[id]` and `GET /api/groups/[id]/expenses` (`src/app/api/groups/[id]/route.ts:33`, `…/expenses/route.ts:62`). Combined with 10–30 s SWR polling on both keys (§8), a single open group page issues repeated write-capable requests. Any HTTP-level assumption that GET is safe — caching, retries, prefetch, a crawler following a link — is violated.

### Tier 2 — data-integrity and consistency hazards

5. **Floating-point money throughout.** `amount` is a `Number` (`src/lib/models/Expense.ts:86`) and every derived figure is float arithmetic with four different rounding conventions: `Math.round(x*100)/100` (`debt-simplifier.ts:15-17`, `expense-summary.ts:42-44`), an `Number.EPSILON`-nudged sign-preserving variant (`dashboard.ts:3-6`), and `Math.floor` + remainder (`split-calculation.ts:29-30`). The `equal` remainder is added _after_ rounding (`:34`), so participant 0 can store a value like `33.340000000000003`; the test acknowledges this with `toBeCloseTo` (`split-calculation.test.ts:30`). `shares` and `percentage` splits are documented and tested to drift by a cent (`split-calculation.test.ts:89-97`).
6. **Group balances silently sum across currencies.** `getGroupBalances` discards currency during projection and returns a single number labelled with the group default (`src/lib/services/balance.service.ts:30-45,87`). The `hasMixedCurrencies` flag warns but the number is still rendered (`src/components/balances/BalancesView.tsx:175,192`). Only reachable via legacy data, but the code has no guard.
7. **Non-atomic read-then-write on tag uniqueness.** `addTag` and `updateTag` check for a case-insensitive duplicate with a `find` and then issue a separate `$push`/`$set` (`src/lib/services/group.service.ts:281-302,330-350`). There is no unique index on `tags.name`, so concurrent adds of the same name both land.
8. **Tag rename orphans expenses.** `Expense.tag` stores the tag _name_, not the subdocument id (`src/lib/models/Expense.ts:111`), and `updateTag` rewrites only `tags.$.name` (`src/lib/services/group.service.ts:342`). After a rename, historical expenses point at a name that is no longer an active tag; `deleteTag`'s in-use check (`:373-378`) also keys on the name, so it will not protect the old one. The expense form works around this by re-injecting an unknown current tag into the selectable list (`src/components/expenses/expense-form-helpers.ts:33-38`).
9. **Activity logging is on the critical path.** Every mutation `await`s `Activity.create` (`src/lib/services/activity.service.ts:16`); a failure there fails the whole request _after_ the primary write has already committed, since there are no transactions anywhere in the codebase.
10. **`checkDuplicate` uses server-local time.** `setHours(0,0,0,0)` / `setHours(23,59,59,999)` (`src/lib/services/expense.service.ts:366-369`) operate in the Node process's timezone, unlike the UTC convention `toInclusiveDateToBound` establishes for the list filter (`src/lib/utils/date.ts:90-98`). The two "same day" definitions can disagree.
11. **Silent stop on recurring problem state, with a client check that is narrower than the server's.** `assertTemplateData` also validates currency (`src/lib/services/recurring-expense.service.ts:66`), but `problemFor` in the UI checks only tag and participants (`src/components/groups/RecurringExpensesSection.tsx:172-183`). A currency-drifted template stops generating and shows no badge.

### Tier 3 — availability, resource and interface hazards

12. **Unbounded reads.** `limit` is `parseInt(searchParams.get('limit') || '20')` with no ceiling (`src/app/api/groups/[id]/expenses/route.ts:78`); and whenever `total > limit`, the summary path re-queries the _entire_ filtered set into memory (`src/lib/services/expense.service.ts:170-174`). `getUserBalances` similarly loads every expense across every group the user belongs to (`src/lib/services/balance.service.ts:106-109`). None of these are paginated or capped, and there is no rate limiting anywhere in the repo.
13. **Invite codes are 32 bits.** `crypto.randomBytes(4).toString('hex')` yields 8 hex characters (`src/lib/services/group.service.ts:406`) — a small space for an unauthenticated, enumerable preview endpoint (`src/app/api/join/[code]/route.ts:41-53`) that leaks group name, category and member count. Any member — not just an admin — can mint one (`:403-404`), with an unvalidated, uncapped `expiresInDays` taken straight from the request body (`src/app/api/groups/[id]/invite-link/route.ts:19-22`).
14. **Prefix-matched public paths.** `pathname.startsWith('/join')` and `.startsWith('/login')` in `authorized` (`src/lib/auth.config.ts:60-61`) match any path _beginning_ with those strings, not just those segments.
15. **Response-envelope inconsistency.** Two tag handlers hand-roll `new Response(JSON.stringify(...))` and omit the `status` field the rest of the API always includes (`src/app/api/groups/[id]/tags/route.ts:28-42`, `…/tags/[tagId]/route.ts:39-44,68-76`), and one omits the `Content-Type` header entirely (`…/tags/route.ts:29-31`). Three user-error cases (last-admin demote/remove, self-remove) are returned as **500** because they route through `serverError` (`…/members/[userId]/route.ts:42-44,65-68`) — which also `console.error`s them and replaces the message with "Internal server error" (`src/lib/utils/api-response.ts:52-55`), so the intended explanation never reaches the client.
16. **Invitation tokens are generated but never used.** `Invitation.token` is a unique-indexed 32-hex-char secret (`src/lib/models/Invitation.ts:25,34`; `src/lib/services/invitation.service.ts:31`) and no route accepts it. Accept/decline are keyed on the invitation `_id` plus an email match (`src/app/api/invitations/[id]/route.ts:28,32`). Also, an email mismatch returns **404** rather than 403 (`src/lib/services/invitation.service.ts:74,121`) — which is arguably the right choice for enumeration resistance but is undocumented.
17. **`fetcher` cannot distinguish "empty response" from "redirected to HTML".** `res.json().catch(() => ({}))` swallows parse failures, and if `res.ok` is true the caller gets `{}` (`src/lib/utils/fetcher.ts:3-7`). Combined with risk #1 in §6.5, an expired session renders as empty data rather than an error.
18. **`NEXT_PUBLIC_APP_URL` is interpolated server-side with no fallback.** If unset, invite URLs become `undefined/join/<code>` (`src/lib/services/group.service.ts:416`, `src/app/api/groups/[id]/invite-link/route.ts:52`) — a silent failure, since neither call site validates it.
19. **No component tests are possible under the current config.** `vitest.config.ts:7` restricts collection to `src/**/*.test.ts`, and the ~9 500 lines of client components include the only implementation of split-total validation, month-range parsing and the recurring problem-state heuristic (§7.5).
20. **Dead-but-rendered features.** `receiptUrl` is in the model (`src/lib/models/Expense.ts:113`) and rendered as a chip (`src/components/expenses/ExpenseCard.tsx:304`) but is absent from both expense Zod schemas (`src/lib/validators/expense.validator.ts:5-39`), and in Zod "[by default, unrecognized keys are _stripped_ from the parsed result](https://zod.dev/api?id=objects)" — so no API path can ever set it. Alongside the unused text index and inert `alternateCurrencies` (§11.4), this is surface area that reads as supported and is not.
21. **Two independent statements of the same split rules.** `ExpenseFormDialog.tsx:295-318` and `RecurringExpensesSection.tsx:213-227` each implement "percentages sum to 100, exact amounts sum to the total" separately, with different messages and different tolerances applied to different field sets — and neither is shared, tested, or mirrored server-side. `ExpenseFormDialog.tsx:207` additionally previews equal splits with plain division while the server stores floor-plus-remainder (§7.5).

---

## 13. Method, and what this document does not claim

- **Nothing was executed.** `node_modules` is absent from this worktree; no `pnpm install`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm demo:seed` or app run was performed. Every behavioural statement is derived by reading source, and every runtime consequence described (e.g. the 302-instead-of-401 chain in §6.5, the index race in §5.4) is a deduction from code plus first-party documentation, not an observation.
- **Line numbers are as of commit `29fcf2e`** on branch `claude/codebase-exploration-e474b7`.
- **The prose docs were audited, but not exhaustively.** §11 covers every checkable claim extracted from `README.md`, `AGENTS.md`, `CONTEXT.md`, `docs/architecture.md`, `docs/api.md`, `docs/database.md`, `docs/auth.md`, `docs/testing.md`, `docs/ui.md`, `docs/features/*`, `docs/pages/*` and `docs/v2|v3|v4/*` that could be checked against source — endpoint paths, verbs, field names, index definitions, defaults, enums, auth rules, response shapes, feature existence and file locations. Prose that is not a checkable factual claim (rationale, roadmap intent, UX narrative) was not evaluated, and `docs/PLAN.md`, `docs/design/private-beta/*` and `docs/superpowers/*` were out of scope.
- **Test outcomes are not claimed.** Test names and assertions were read; whether they currently pass was not verified.
- **Two claims in this document rest on published third-party source rather than on this repo:** that next-auth converts an `authorized` return of `false` into a redirect (from `next-auth`'s own `packages/next-auth/src/lib/index.ts`, matched against the pinned `5.0.0-beta.30`), and that Mongoose's `autoIndex` does not block writes on index completion (from the Mongoose guide). Neither was observed at runtime.
