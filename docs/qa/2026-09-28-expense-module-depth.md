# Expense money edits and draft recovery verification

Implementation of [Spec #65](https://github.com/FireBird1998/splitbook/issues/65) and tickets #66–#70. Code reviewed against `f07206f4e02e9bda0732912e9ff3d9031c1aa42c`; final implementation commit: `c9f6ca529d80616249afaab09e34b54710864f2c` (following `a482382`). This report is a subsequent documentation-only commit.

## Delivered behavior

- `@splitbook/shared/expense-money-edit` interprets stored money and decides whether to preserve historical allocations or normalize a merged financial edit. Manual and recurring services, initialization and previews consume it. Existing exact-money arithmetic remains authoritative; request fingerprints and authorization stay separate.
- Equal, percentage and shares edits compare their financial definition rather than derived amounts. Participant identity normalization and row-order-independent comparison preserve historical minor units. Exact and unequal splits compare entered amounts. Compatible legacy tails and supported currency precision remain supported; invalid money produces an explicit editing/preview error.
- `@splitbook/shared/expense-draft` owns editable values, saved base/revision, prepared and attempted submission snapshots, retry identity, validation, completion and conflict/reload transitions. The web adapter owns transport, advisory duplicate confirmation, rendering and read invalidation. Account/Group/Expense identity and dialog lifetime isolate drafts; background refresh cannot replace the base or entered values.
- An unchanged create retry reuses its body/key without another duplicate prompt. Changed submitted content becomes a new explicit action. Stale edits retain the draft; failed reloads retain recovery context; successful explicit reloads adopt the latest saved revision.
- Recurring eligibility, schedules, generation progress and already-generated Expenses remain unchanged. No schema, migration, authentication configuration, fingerprint or production operation was introduced.

## Verification

All database work used a new disposable MongoDB container, `splitbook-expense-depth-test-65`, exposed only on `127.0.0.1:27017`. The existing user MongoDB container on port 27018 was not modified. Authenticated suites minted UUID database names; integration suites used their existing per-file names within the fresh test-only instance. Core/Google/pilot suites used uniquely suffixed databases in the same disposable instance.

| Command or suite                                                                     | Result                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------- |
| `pnpm test` — final shared domain suite                                              | 190 passed                                  |
| `pnpm test` — final web unit and real-Mongo integration suite                        | 249 passed                                  |
| `pnpm test` — mobile regression suite                                                | 67 passed                                   |
| `CI=1 pnpm web test:expense-access` — final isolated production app                  | 116 passed; production build passed         |
| `CI=1 pnpm test:e2e` — desktop/mobile × light/dark                                   | 48 passed                                   |
| `CI=1 pnpm test:e2e:google` — simulated Google authentication                        | 7 passed                                    |
| `pnpm web exec playwright test --config playwright.auth-recovery.config.ts`          | 4 passed                                    |
| `pnpm web exec playwright test --config playwright.auth-production.config.ts`        | 7 passed; isolated production builds passed |
| `pnpm test:design-system` — Linux catalogue, accessibility and visual comparisons    | 20 passed                                   |
| `CI=1 pnpm test:pilot` — Linux recovery, focus, accessibility and visual comparisons | 56 passed                                   |
| `pnpm test:production-ui`                                                            | 1 passed                                    |
| Workspace lint, typechecking and formatting                                          | Passed                                      |
| `pnpm web check:design-system`                                                       | Passed, 8 adopted files                     |
| Isolated `pnpm build`                                                                | Passed                                      |

The full workspace suite passed on the final implementation commit. Focused money/draft tests used the same interfaces as production callers. New tests followed red-before-green for the initial modules and review regressions. Existing arithmetic, authorization, database-failure and Activity recovery suites remain intact.

The authenticated suite retains real successful financial commits. New coverage verifies historical equal-split preview after participant reorder, metadata save/read-back and unchanged Balances; recurring historical preview/save parity and unchanged generated Expenses after a financial template edit; failed explicit reload; changed-content retry with a distinct key and two explicit actions; and validation/duplicate cancellation followed by a real save despite advisory failure. Existing lost-response coverage verifies one Expense and one creation Activity after an unchanged retry.

The initial focused and development-mode full acceptance runs also passed (114 tests before two added retry cases). All three final retry journeys passed separately. Test assertions and stored visual baselines were not weakened or regenerated.

## Review

### Standards

Independent review found no documented-standard violations or actionable baseline smells. Shared code has no platform or persistence dependencies; browser effects remain in the web adapter. The review respected workspace, domain and authentication ADRs.

### Spec

Independent review identified two regressions: blank Shares entry bypassed the previous validation, and malformed participant collections could throw before the invalid-money recovery path. Both were reproduced with failing public-interface tests, fixed, and reviewed again with no remaining findings. A related unsupported-currency initialization case was also covered and fixed so invalid stored currency cannot crash editable money controls.

Final review: 0 remaining Standards findings; 0 remaining Spec findings.

## Environment findings and limits

- Installed missing workspace dependencies with `pnpm install --frozen-lockfile`; no lockfile changes.
- One final isolated production acceptance build hit a transient `next/font` asset-URL parsing error; a fresh retry compiled successfully. No font configuration was changed.
- One development acceptance run failed during fixture creation with a Next.js request-scope error. A fresh isolated rerun passed; final acceptance uses production mode.
- The temporary catalogue checkout's linked `node_modules` directory is outside Turbopack's root. Its temporary test command was changed to `next dev --webpack`, matching the existing expense-access harness. Application configuration and tracked visual baselines were unchanged.
- Wider browser suites and build ran from a temporary source snapshot without `.env.local` or the user's `.next` directory. Temporary config changes only provided unique database names and the catalogue's Webpack flag. Linux visual checks used the repository's Playwright 1.62.1 image.
- Google tests use deterministic synthetic identities; this work does not verify live production Google sign-in. Physical devices, Safari, Firefox, Atlas and deployment were outside scope.
- Parent #65, attached plans/specs, the user's pre-existing `CONTEXT.md` edits and other untracked documents remain untouched. Commits remain local; no push or deployment was performed.

## Evidence and cleanup

Run logs and retained screenshots/reports are saved locally under `apps/web/output/playwright/expense-module-depth/`. Both task-created containers were stopped and removed, including their disposable databases. The temporary source/build snapshot was removed after retaining evidence. No test servers remain on ports 3100, 3101, 4128, 4129 or 9323. The original `splitbook-mongo` container remains running on port 27018.
