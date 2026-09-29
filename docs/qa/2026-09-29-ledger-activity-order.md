# Ledger publication ordering and final verification

Implements #78 and records #79 verification under unchanged parent #73. Characterization and accepted baseline evidence are in [the #77 report](2026-09-29-ledger-characterization.md). PRs are stacked for review; none is merged by this task.

## Change and consolidation decision

Fresh Settlement creation now attempts bounded, recoverable Activity publication before response population, matching fresh Expense creation and both writers' normal replay and collision recovery. The financial record and its pending intent still commit atomically in one document. Activity failures remain recoverable; response preparation can still fail after commit and a same-key retry recovers the original record.

Retain two explicit writers. Expense must look up replay before preparing the normalized command because immutable historical Tag identity affects that preparation; it checks current actor access before replay but other participant eligibility only for a new write. Settlement normalizes and validates both parties and recording authorization before replay. Expense prepares historical/display Tags, while Settlement defaults its payer and obtains party names for its Activity payload. Their record shapes, normalization and population paths also differ.

A shared coordinator would need callbacks/adapters for command preparation, eligibility, lookup/insertion, event construction and response preparation, or leave those sequencing decisions with both callers. That moves code without reducing the knowledge needed to maintain either writer. Existing shared modules already own immutable fingerprints/intent construction, currency locking, index readiness and bounded idempotent publication/acknowledgement. No new coordinator or caller interface is introduced. The only application change is the approved ordering correction.

## Red before green

The #77 baseline test was first changed to require one published Activity even when fresh response preparation fails. On the original implementation it failed only for Settlement (expected1, observed0); the other9 creation fault cases passed. After moving publication ahead of population, all10 creation recovery and6 existing outbox tests passed. These use real standalone Mongo commits and isolated infrastructure failures, including concurrent insert races, outages and failed acknowledgement. No production fault routes or mocked successful financial commits were added.

## Final verification

Tested application/test revision: `70a447f22226ccb5da1b21293e4b490abcf1d01f`. This completed report is a later documentation-only commit. Commands below used `npm_config_manage_package_manager_versions=false` to avoid this host's broken pnpm version-switch wrapper.

| Check on the final revision                                                                   | Exact result                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm -r test`                                                                                | 726 passed: shared 259, web 275 (including real Mongo), mobile 192 |
| `CI=1 pnpm --dir apps/web test:expense-access`                                                | 157 passed in 2.7 minutes; isolated production build passed        |
| `CI=1 pnpm --dir apps/web exec playwright test --config playwright.auth-production.config.ts` | 7 passed in 38.9 seconds; isolated production builds passed        |
| `pnpm -r lint`                                                                                | Passed across all three packages                                   |
| `pnpm -r typecheck`                                                                           | Passed across all three packages                                   |
| `pnpm exec prettier --check .`                                                                | Passed                                                             |
| `pnpm --dir apps/web check:design-system`                                                     | Passed, 8 adopted files                                            |
| `git diff 0245465...HEAD --check`                                                             | Passed                                                             |

The 157-test run includes all authenticated access, exact-money, recurring, draft/conflict/reload, Group response, Tag, profile, concurrency and actual lost-response browser journeys, including the new 12 HTTP characterization cases. Existing desktop/mobile and accessibility checks remain. No UI or visual-baseline files changed.

### Native client compatibility

All seven existing native controller verification scripts ran through real authenticated HTTP against their own production snapshot of the final revision, using `MOBILE_VERIFY_URL` with a random loopback port and a separate UUID database. Expense create/edit, Settlement, Activity and offline checks include real commits, lost responses, explicit retry, disk restart, account isolation, denied access and single financial/Activity effects.

| Script under apps/mobile/scripts | Outcome | Assertion calls |
| -------------------------------- | ------- | --------------- |
| verify-api.ts                    | Exit 0  | 45              |
| verify-expense-create.ts         | Exit 0  | 298             |
| verify-expense-edit.ts           | Exit 0  | 166             |
| verify-settlements.ts            | Exit 0  | 182             |
| verify-activity.ts               | Exit 0  | 130             |
| verify-offline.ts                | Exit 0  | 87              |
| verify-financial-views.ts        | Exit 0  | 246             |

The 1,154 assertion calls include repeated transport safety checks; they are not 1,154 separate tests. The ignored runner is retained at `apps/web/output/playwright/ledger-native/run.ts`. It starts `startIsolatedApp('demo', undefined, true)`, inserts only the synthetic verification fixtures in that allocated database, supplies each child an absolute mobile tsconfig, and cleans up in finally.

### Independent review

Standards review: 0 findings. Spec review: 0 findings. Reviewers examined the fixed diff `0245465...70a447f` against repository standards and #73/#78. The earlier characterization also received separate reviews with 0 findings. Reviewers did not claim independent test execution.

### Limits, failures and cleanup

- The native scripts exercise the actual controller, transport, parser and disk-recovery contracts; they are not an emulator or physical-device run. Native OAuth, signed APK distribution and production Google/Atlas verification remain outside this assignment.
- The first native runner launch passed a relative tsconfig path to child processes; all children exited before assertions. Only the ignored runner was corrected; a fresh isolated run passed all seven scripts. No application fix was required.
- Characterization development failures and the transient next/font build failure are disclosed in the #77 report. Final local workspace, browser and production-auth runs passed. The ordering assertion's intentional red run is retained separately from successful verification.
- The task-owned Mongo container `splitbook-ledger-followup-77` was removed after all local checks, including residual per-file test databases. Native and browser helpers stopped their servers and removed snapshots/UUID databases. The user's `splitbook-mongo` on port 27018, primary dirty checkout, environment files and plans were preserved.
- Run logs are retained locally under `apps/web/output/playwright/ledger-followup/`. No application configuration, schema, route, request/response format, fingerprint, recurring identity or rounding rule changed. Parents #65/#73 remain open and unmodified.
- PRs #87 → #88 → #89 are stacked in dependency order and remain unmerged for independent QA. Repository automation created Vercel preview deployments after pushes; no manual or production deployment was performed.

### CI on the tested source revision

[CI run 36569230001](https://github.com/FireBird1998/splitbook/actions/runs/36569230001) completed successfully on exact head `70a447f22226ccb5da1b21293e4b490abcf1d01f`. Both verify and playwright jobs passed. These are retrieved CI results, distinct from the fresh local results above:

| CI suite                                              | Result                                         |
| ----------------------------------------------------- | ---------------------------------------------- |
| Workspace tests                                       | Shared 259 + web 275 + mobile 192 = 726 passed |
| Authenticated isolated app/Mongo                      | 157 passed in 4.8 minutes                      |
| Core desktop/mobile, light/dark                       | 48 passed                                      |
| Simulated Google journeys                             | 7 passed                                       |
| Auth recovery                                         | 4 passed                                       |
| Linux component visual/accessibility                  | 20 passed                                      |
| Pilot behavior/focus/visual/accessibility             | 56 passed                                      |
| Production UI exclusion                               | 1 passed                                       |
| Lint, type checking, design policy, production builds | Passed                                         |

Earlier stacked PRs also completed CI successfully: [PR #87 run](https://github.com/FireBird1998/splitbook/actions/runs/36567581112) and [PR #88 run](https://github.com/FireBird1998/splitbook/actions/runs/36568810176). Final QA documentation is a subsequent documentation-only commit; no code changed after the tested source revision.
