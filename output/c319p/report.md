# Whole-trip Payments follow-up — 9 October 2026

Implemented and committed locally only. Nothing pushed; no PR opened. The abandoned
`feat/319-trip-payments` branch and worktree were not used or changed.

## Git

- Branch: `codex/319-trip-payments`, with no upstream.
- Base: `d49de57357d8ac3acb6e1dc785be1d86a8ffa475` (fetched origin/main).
- Tip: `323ad7614be4c971a11bdd68a034783666e1602c`.
- Commit: `Statement: a whole trip lists every Payment, including after the trip (#319)`.
- Nine files; 151 insertions, 17 deletions. No files under apps/mobile changed.

## Implemented rule

For `scope=trip`, `buildStatement` selects every Settlement of the Group regardless of
Trip dates. Each currency's Payments are sorted oldest first by instant, then id, with
recorder names; the count and exact minor-unit total use that complete list. Payment
labels reuse the existing Expense `outsideTrip` helper, which reads Trip boundaries
and Payment instants as days in the viewer's time zone. Earlier/later days display
“Before the trip”/“After the trip”; dates within the span have no label.
The Payments caption states: “Every recorded payment, including those before and after
the trip.” An empty whole-trip list says “No payments recorded.”

Period statements still filter Payments to their from/to window and show no Trip labels.
Current balances and suggestions remain all-time. Expense Spent, Paid, Share, Net and
outside labels are unchanged. Settlements are never attributed to a Month.

## Changed files

- `packages/shared/src/statement.ts` — whole-trip Payment selection and outsideTrip labels.
- `packages/shared/src/statement.test.ts` — before/during/after, viewer-zone boundary,
  ordering, recorder, count/total and period filtering coverage.
- `apps/web/src/components/statement/StatementView.tsx` — scope caption, labels and empty copy.
- `apps/web/src/components/statement/StatementView.test.ts` — rendered post-trip mark,
  timestamp from the existing formatter, recorder and total.
- `apps/web/src/app/api/export/route.integration.test.ts` — stored post-trip Payment in a
  whole-trip statement, excluded from a period, with unchanged all-time balances.
- `apps/web/playwright/export-backup-statement.spec.ts` — seeded Alex → Sam ₹4,000 Payment,
  After the trip mark, recorder and Payments-section screenshots.
- `docs/api.md` — statement Payment scope and never-by-Month rule.
- `docs/export-backup.md` — reconciled statement behaviour.
- `docs/qa/2026-10-07-export-backup-statement.md` — owner decision and obsolete limitation removed.

## Verification commands and results

All pnpm commands used PATH=/tmp/splitbook-expense-bin:$PATH to use the installed
pnpm 10.23.0 runtime. Fictional data only. No emulator, port 3100, port 4138 or Mongo 27017
was used. Mongo's existing splitbook-mongo container was reused on host port 27018.

| Command | Result |
| --- | --- |
| `git fetch origin && git switch -c codex/319-trip-payments origin/main && git branch --unset-upstream` | Passed; current main base recorded above. Initial sandbox fetch denied the FETCH_HEAD write; retry with repository access passed. |
| `pnpm install`, then `CI=1 pnpm install` | Initial sandbox attempt hit network/non-TTY restrictions; retry passed, lockfile unchanged. |
| `pnpm exec prettier --write <the nine changed files>` | Passed. |
| `TZ=UTC pnpm --filter @splitbook/shared exec vitest run src/statement.test.ts --maxWorkers=2` | 14 tests passed. |
| `pnpm format:check` in existing workspace | Interrupted after warnings in unrelated .claude abandoned worktree/generated files. A retry excluding .claude/output still failed on 868 existing/generated artifacts, including .next and reports. No unrelated files formatted. |
| `pnpm exec prettier --check --ignore-unknown <git ls-files>` | All tracked files passed. |
| `pnpm exec prettier --check <the nine changed files>` | Passed. |
| `git archive HEAD` into `/tmp/c319p-format-export`, then `pnpm --dir /tmp/c319p-format-export format:check` | Passed on the clean committed tree. Existing node_modules was linked only to run Prettier; scratch export removed. |
| `pnpm lint` | Passed: 0 errors, 5 existing web navigation warnings. |
| `pnpm typecheck` | Passed across the workspace. |
| `pnpm web check:design-system` | Initial sandbox run could not open tsx IPC socket; retry passed, 68 adopted files. |
| `TZ=UTC pnpm test:unit --maxWorkers=2` | Initial sandbox swarm tests failed; permitted rerun passed: shared 1,480 + swarm 122 + web 814 + mobile 2,020 = 4,436 tests, 211 files. |
| `TZ=Pacific/Pago_Pago pnpm test:unit --maxWorkers=2` | Same 4,436 tests and 211 files passed. |
| `TEST_MONGODB_URI='mongodb://127.0.0.1:27018/?directConnection=true' pnpm test:integration --maxWorkers=2` | 394 tests, 36 files passed. Each file used its dedicated splitbook-test-* database and dropped it on teardown. |
| `AUTH_MODE=demo ALLOW_DEMO_AUTH=true AUTH_RATE_LIMIT_ENABLED=false AUTH_SECRET=<fictional-local-secret> MONGODB_URI='mongodb://127.0.0.1:27018/splitbook_c319p?directConnection=true' NEXT_PUBLIC_APP_URL=http://localhost:3318 pnpm build` | Production build passed. |
| `AUTH_MODE=demo MONGODB_URI='mongodb://127.0.0.1:27018/splitbook_c319p?directConnection=true' RECURRING_EXPENSES_ENABLED=true pnpm web demo:reset` | Seeded a fresh fictional database. |
| `AUTH_MODE=demo ALLOW_DEMO_AUTH=true AUTH_RATE_LIMIT_ENABLED=false AUTH_SECRET=<fictional-local-secret> MONGODB_URI='mongodb://127.0.0.1:27018/splitbook_c319p?directConnection=true' NEXT_PUBLIC_APP_URL=http://localhost:3318 RECURRING_EXPENSES_ENABLED=true pnpm web exec next start -p 3318` | Isolated production server started; stopped after checks. |
| `pnpm web exec playwright test --config c319p.playwright.config.ts export-backup-statement.spec.ts trip-summary.spec.ts --workers=1` | 38 passed, 2 intentional mobile tooltip skips; desktop/mobile × light/dark. Temporary config inherited existing projects but disabled default 3100 server/global setup and pointed only to 3318. |
| `pnpm web exec playwright test --config c319p.playwright.config.ts export-backup-statement.spec.ts --grep 'Share wrap-up' --workers=1` | 4 passed after adding the focused Payments screenshots. |
| `docker run --name splitbook-c319p-browser --platform linux/amd64 --rm -d --init --ipc=host -p 127.0.0.1:9338:9338 mcr.microsoft.com/playwright:v1.62.1-noble /bin/sh -c 'npx -y playwright@1.62.1 run-server --port 9338 --host 0.0.0.0'` | Started the specified Linux browser; stopped afterward. |
| `C319P_PILOT=1 DESIGN_BROWSER_WS=ws://127.0.0.1:9338/ pnpm web exec playwright test --config c319p.playwright.config.ts statement-print.spec.ts --workers=1` | Four baselines matched, compare only. The pilot is a period statement, so no re-recording was needed or performed. |
| `git diff --check` | Passed. |
| `git add <the nine files> && git commit -m 'Statement: a whole trip lists every Payment, including after the trip (#319)'` | Local commit 323ad76 created; no push. |
| `docker stop splitbook-c319p-browser`; stop own 3318 server; drop only `splitbook_c319p`; remove temporary config/export | Completed. Existing Mongo container and all unrelated services/data left in place. |

Full verification logs are retained in `output/c319p/logs/`. Temporary /tmp logs and
scratch configuration/export were removed after retaining evidence.

## Screenshots

Visually inspected the desktop and mobile Payments-section captures. The desktop shows
Alex Rivera → Sam Chen, ₹4,000, “After the trip” and Alex Rivera as recorder. Mobile retains
the existing sideways-scrolling table.

- `/Users/ankitdas/AnkitPersonalProjech/SplidBook/output/c319p/screenshots/trip-statement-payments.png`
- `/Users/ankitdas/AnkitPersonalProjech/SplidBook/output/c319p/screenshots/trip-statement-payments-mobile.png`

## Draft PR title

Statement: include every Payment in a whole-trip wrap-up

## Draft PR body

Part of #319 and #300.

Whole-trip statements now list every recorded Payment of the Group, including settlements
before and after its Trip dates. Payment counts and totals follow that list; outside
Payments use the same viewer-time-zone day labels as Expenses, and the caption explains
that all payments are included. Period filtering, all-time balances and Expense figures
keep their existing rules. #319 is already closed; this is a small follow-up to the owner's
9 October decision.

Needs the `full-ci` label.

Validation: 4,436 unit tests in both UTC and Pacific/Pago_Pago; 394 real-Mongo integration
tests; 38 production demo browser tests passed with 2 intentional skips; the updated
wrap-up journey passed in all four projects. Four Linux print baselines matched without
re-recording. Lint, typecheck, design-system policy and clean-tree format checks passed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

## Browser check and publication follow-up

The owner subsequently authorized browser verification and merging if all checks pass.
A fresh production demo used only splitbook_c319p_browser on Mongo 27018 and port 3318.
The in-app browser's Share wrap-up journey showed Payments: 1 · ₹4,000, with Alex Rivera
paying Sam Chen, After the trip, and Alex as recorder. The September period showed
Payments: 0 · ₹0 and No payments in this period, with the same all-time balances.
The app rendered in both themes. The browser tab and server were closed, and only the
fictional browser database was dropped.

Screenshot: output/c319p/screenshots/browser-payments.png.
PR opened: https://github.com/FireBird1998/splitbook/pull/374, full-ci label, head 323ad76.
The branch remains available. No Android files changed; mobile has no import of the
statement module, and all 2,020 mobile tests passed in both UTC and Pago Pago.

## Merge result

- PR #374 squash-merged after all applicable CI checks passed; the Nightly gate was intentionally skipped.
- Tested head: 323ad7614be4c971a11bdd68a034783666e1602c; base remained d49de57357d8ac3acb6e1dc785be1d86a8ffa475.
- Full CI run: 37954024969, successful; Playwright 23m38s, verify 10m14s, PR checks 4m20s and all timezone suites passed.
- Merge/current local main: e0d9d0c712f749699b58e1ac542ed744ac61598f.
- Production Vercel status: success.
- Deployment: https://vercel.com/ankit-das-projects/splitbook/4VjuJvrowWgtkx5wAVH42oNFVsEg
- Feature branch retained; no direct push to main; output/ remains untracked and intact.
