# Expense acceptance baseline handoff

Baseline: `9c6de8e823008b7c5237164349fd8a56dd4848b0` (current origin/main on 29 September 2026). Supplemental acceptance test: `64a105c`.

## Acceptance reconciliation

The implementation for #66–69 is already merged. No replacement implementation is needed. The committed [original QA report](2026-09-28-expense-module-depth.md) records the original implementation revision and full acceptance results. The local independent review report at `docs/qa/2026-09-28-expense-independent-review.md` is supporting, uncommitted evidence; its pending-CI limitation is historical.

- #66: `expense-money-edit` owns stored-money interpretation, financial equivalence and preserve/recalculate decisions. Manual service and draft preview consume it. Pure money tests plus ledger-integrity and ledger-money browser tests cover all split definitions, historical allocations, precision, invalid data and Balance preservation. Access, revisions, Tag, currency, restoration and immutable creation fingerprints retain separate tests.
- #67: recurring editing and preview use that same decision. `recurring-stored-money.spec.ts` verifies historical preview, metadata and financial saves, and unchanged earlier Expenses. The supplemental real-Mongo recurring-hardening test generates the next period after a financial edit, checks edited payer/participant allocations against preview and saved template, keeps the earlier record unchanged, verifies one generation per period, exact Balances and creation Activity count.
- #68: the shared ExpenseDraft owns editable values, attempted serialized requests, retry keys and recovery transitions. The actual browser lost-response test commits via route.fetch before losing the response, then asserts one Expense and one creation Activity. Validation, duplicate cancellation/advisory failure and changed-content retry remain covered.
- #69: the same draft owns saved base/revision, conflict and explicit reload. Browser tests perform a winning concurrent edit, stale409, background refresh, failed reload and successful explicit reload. Group/account/Expense identity keys preserve the existing dialog lifetime.
- #70: source review found no replaced policy bridge or duplicated money-equivalence/lifecycle owner. Existing arithmetic, authorization, persistence-failure and integration suites remain. No request/schema, rounding, auth or fingerprint changes are introduced by this handoff.

## Exact verification

[Main CI36557536483](https://github.com/FireBird1998/splitbook/actions/runs/36557536483), on the exact baseline SHA above, succeeded. Results below are retrieved CI evidence, not fresh local reruns:

| Command/suite                                          | Result                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Workspace tests                                        | Shared259 + web264 (including real Mongo) + mobile192 =715 passed |
| Authenticated isolated production app/Mongo            | 145 passed                                                        |
| Core browser desktop/mobile and light/dark             | 48 passed                                                         |
| Simulated Google                                       | 7 passed                                                          |
| Auth recovery                                          | 4 passed                                                          |
| Linux design catalogue visual/accessibility            | 20 passed                                                         |
| Pilot recovery/focus/visual/accessibility              | 56 passed                                                         |
| Production UI exclusion                                | 1 passed                                                          |
| Workspace lint/types, design policy, production builds | Passed                                                            |

Fresh local supplemental checks:

- `pnpm --dir apps/web exec vitest run src/lib/services/recurring-hardening.integration.test.ts`:16 passed, including the missing future-generation assertion, on64a105c.
- `pnpm format:check`:passed on the clean baseline. Added test formatted with Prettier; targeted ESLint and git diff whitespace check passed.
- `pnpm -r typecheck`: passed across shared, web and mobile after frozen-lockfile dependency refresh.

Local pnpm commands use `npm_config_manage_package_manager_versions=false`; recursive checks invoke `pnpm -r` directly because the installed package-manager switching wrapper cannot locate10.23.0. Initial local typecheck found missing expo-sqlite from the reused checkout; frozen-lockfile installation refreshed the three missing packages without lockfile changes.

## Review and limits

Independent source acceptance audit identified the missing future-generation assertion; it is now covered without changing application behavior. Separate reviews of the supplemental test returned Standards: 0 findings; Spec: 0 findings. Reviewers inspected source and did not claim independent test execution.

The new test uses the existing service seam and actual disposable MongoDB on isolated loopback27017. The user's persistent Mongo on27018, primary checkout changes, environment files and plans are preserved. CI uses isolated runner Mongo; browser tests use generated test database names. Prior auth-production7 results remain historical evidence from the original QA report, not a new run here. Synthetic Google tests do not verify live-provider or production OAuth. No production operation, deployment, native OAuth or APK distribution is included. Parent#65 remains open and unchanged.
