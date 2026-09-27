# Ledger implementation and QA follow-through — 24 September 2026

The nine ledger tickets [#40–48](../plans/2026-09-16-ledger-hardening-tickets.md) remain implemented on `codex/ledger-schema-hardening`. This pass rechecked their implementation, corrected an additional recurring-money defect, closed the outstanding Settings/contrast/layout findings, and extended regression coverage. The approved specification and plan were preserved.

## Findings resolved

- **QA-01, preferred currency:** New Groups load the saved preference. Delayed responses cannot replace an explicit selection, including choosing the already displayed INR value with the keyboard. Submission waits for the preference unless the user chooses a currency; failed or unsupported preferences retain the supported fallback.
- **QA-02, silent Settings errors:** Validation, rejected requests and network failures produce visible feedback while retaining the draft. Profile loading has visible failure/retry behavior, and late responses preserve fields the user has already edited.
- **QA-03, blank names:** The shared profile validator trims before enforcing length. Whitespace-only updates are rejected without changing persisted values; database update validation also runs.
- **QA-04, contrast:** Settings session/sign-out text and the light-theme persona role labels use readable semantic foregrounds. Core accessibility checks now fail on serious as well as critical findings, retain full node diagnostics, and cover login and Settings, including validation errors. Scans wait for fonts, palette application and finite entrance animations; no contrast rules were disabled. Fresh scans did not reproduce the earlier dashboard/balance contrast counts after rendering settled.
- **QA-05, obscured balances:** The desktop Add Expense action now lives in the workspace header. Geometry regressions reproduced the old floating button covering balance amounts in both themes and passed after the change. The mobile action remains covered by the existing responsive journeys. Only the two desktop balance visual baselines changed, and their image differences were inspected.
- **Recurring historical rounding:** A metadata-only update with reordered participants could redistribute a historical penny. Financial-definition comparison now matches participants by identity. The failing database regression passed after the fix; stored participant order and allocations are retained.
- **CI/browser coverage:** The verification job now installs Chromium before its expanded authenticated browser suite. Direct browser regressions cover Settlement lost-response retries/key rotation and recurring stale-edit draft preservation/reload recovery.
- **Runtime login mode:** The new production login checks found that `/login` had been statically generated with the build-time auth mode. The route now renders dynamically, so the same build respects runtime demo/Google configuration. The existing production demo guard and Google allowlist are unchanged. The Google redirect assertion now uses the configured test origin, allowing verification on a free port without interrupting another local server.

## Verification

**656 distinct automated tests passed**, plus the synthetic read rehearsal and static/build checks. Focused red/green runs and repeated checks are not added again to this total.

| Check                                                                    | Result                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Shared domain tests                                                      | 168 passed                                                    |
| Web unit/database integration tests                                      | 244 passed                                                    |
| Complete isolated authenticated HTTP/browser suite                       | 112 passed                                                    |
| Production desktop/mobile × light/dark journeys                          | 48 passed                                                     |
| Linux pilot recovery, responsive layout, accessibility and visual checks | 56 passed: 54 initial plus 2 reviewed desktop baseline reruns |
| Linux component catalogue and accessibility                              | 20 passed; existing baselines unchanged                       |
| Simulated Google authentication on final production build                | 7 passed                                                      |
| Production design-catalogue exclusion                                    | 1 passed                                                      |
| Workspace lint, TypeScript, formatting, design policy, production build  | Passed                                                        |

The complete production journey run passed after correcting the build/runtime login mismatch. The same final build passed the Google suite. No test was skipped or accessibility rule disabled to obtain these results. Initial failures and subsequent verification logs are retained under `verification/` in the evidence directory.

The durable [read rehearsal](../../apps/web/scripts/rehearse-ledger-reads.mjs) now accompanies the [migration runbook](../operations/ledger-migration.md). It accepts no target overrides, creates a unique database on loopback MongoDB, checks equivalence, and removes its disposable data. Its fresh execution reproduced the prior synthetic results: dashboard projection reduced raw JSON by 97.91%, list projection by 95.77%, and the default list query examined 20 rather than 180 documents without a blocking sort. These are synthetic payload/query-plan comparisons, not production latency claims.

Evidence is retained in `apps/web/output/playwright/qa-2026-09-24/` and `apps/web/output/playwright/ledger-migration/`. The durable tests and rehearsal script belong to the implementation; generated reports, traces and screenshots remain ignored local artifacts. The earlier [ledger verification report](2026-09-16-ledger-hardening.md) records the original migration CLI audit/apply/rerun rehearsal and broader adversarial coverage.

## Delivery and limits

Implementation remains local and uncommitted. Production deployment and production migration were not performed. The parent specification issue was not modified, and `.claude/` was left untouched.

The QA application servers and disposable Linux browser were stopped; the browser container was removed. The two named core/pilot and Google QA databases were removed and confirmed absent. Existing persistent demo, application and OAuth databases were not used by this pass: core/pilot and Google configurations pointed to disposable QA databases, and the request/integration harnesses created their own test databases. Existing Mongo services retained their prior running/stopped states; the unrelated server occupying port 3101 was left running.

An interrupted profile test left one isolated database and app snapshot behind. Their exact ownership was confirmed from the matching snapshot/seed timestamps, origin and unique test writes before removing them. Their absence was verified; the abandoned test server was already stopped.

Google tests use the synthetic provider; real Google, Atlas, Vercel, Safari, Firefox and physical devices were not exercised. Browser accessibility checks are automated checks rather than a complete assistive-technology audit. The migration runbook still requires a separately controlled production rollout.
