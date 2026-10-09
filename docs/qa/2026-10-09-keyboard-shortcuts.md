# Keyboard shortcuts: rebase and final verification (#322)

## Delivery

- Branch: `codex/322-shortcuts`, with no upstream.
- Initial verification base: `d49de57357d8ac3acb6e1dc785be1d86a8ffa475` (`origin/main` fetched at task start).
- Starting branch remains untouched in its other worktree: `feat/322-shortcuts`, tip `4ce3f010bdd25515578e5890d835027d3d7d0854`, original base `cb57603`.
- `af0d8c8` — Web: keyboard shortcuts, with a Settings switch (#322). Rebased implementation of original `a3abea3`.
- `fbc9e59` — Test Trip table shortcuts across day headings (#322).
- `d650ac5` — Refresh desktop shortcut hint baselines after rebase (#322).
- Code and baseline tip: `d650ac5`; the verification-report commit follows. Use `git log d49de573..HEAD --oneline` for the final local commit list.
- At initial local delivery: no GitHub writes, push, PR creation, merge or deployment. No changes under `apps/mobile`. The prior `codex/319-trip-payments` branch and existing untracked `output/` contents are preserved.

The authoritative source is the owner's attached #322 handoff, supplemented by GitHub issue #322 and parent #300, including their comments (none on #322). Native dependencies #311 and #321 are closed. The handoff explicitly overrides the original issue's X-selection requirement: selection and bulk actions remain deferred.

## Rebase conflicts

| File                                                   | Resolution                                                                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/expenses/ExpenseTable.tsx`    | Kept main's Fragment, TripDayRow, dayHeadings prop and date cell. Added the existing shortcut hook, onEdit, focused-row highlight and button scroll margins. Heading rows remain outside `tr[data-expense-id]`. |
| `apps/web/src/components/expenses/ExpenseListView.tsx` | Passed both dayHeadings and onEdit. Kept the Trip heading memo and the existing editRow action.                                                                                                                 |
| `apps/web/scripts/check-design-system.ts`              | Retained all main's export, statement, Trip and refusal-view entries and added both shortcut components.                                                                                                        |
| Four desktop pilot PNGs                                | Took main's versions during rebase, dropping obsolete screenshot-only commit `4ce3f01`. Recorded fresh Linux images in a separate commit.                                                                       |

`docs/ui.md` and `docs/testing.md` merged automatically, preserving both sides. Main's #315 Insights, #317 CSV export, #318/#319 JSON/statement/Share wrap-up, #316 Trip headings and Android merges remain in the base. No new behavior was invented during conflict resolution.

## Preserved behavior

One shortcut table drives matching and hints, with one page listener in the signed-in provider. N opens Add expense; / searches the Group, navigating to Expenses when needed, or opens global search outside a Group. ⌘K / Ctrl+K remains available with single keys off. Single keys pause in text inputs, composition, dialogs and menus. The per-member localStorage switch is in Settings; storage failures are guarded.

J/K move focus between native row buttons. Every row retains its Tab stop. Enter toggles the panel; E edits only while the table has focus. X remains absent. Desktop hints and the Expenses footer reflect the setting; the footer links to Settings. The panel has no misleading E hint, and phones show neither hints nor the footer.

The added public browser regression verifies a Trip heading between Expense rows, walks all rows with J and K across every heading, verifies boundary behavior, checks Tab access and opens then closes a row with Enter. The existing matching and Settings unit tests were retained. No new internal test seam was introduced.

## Verification commands and results

All runner output is retained under `output/c322/logs/`. Scratch runner configurations are retained under `output/c322/runner-configs/`; their scratch app path is intentionally removed during cleanup.

| Command                                                                                                                                                                                                                            | Result                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `git fetch origin`                                                                                                                                                                                                                 | Passed; pinned main to d49de573.                                                                                                                                                                                                                 |
| `git switch -c codex/322-shortcuts feat/322-shortcuts`                                                                                                                                                                             | Passed.                                                                                                                                                                                                                                          |
| `git branch --unset-upstream`                                                                                                                                                                                                      | Reported no upstream: the new branch already had none.                                                                                                                                                                                           |
| `git rebase origin/main`, followed by staged resolutions and `GIT_EDITOR=true git rebase --continue`                                                                                                                               | Completed after the three source conflicts and four PNG conflicts above.                                                                                                                                                                         |
| `pnpm lint`                                                                                                                                                                                                                        | Passed, 0 errors and 5 pre-existing Next internal-navigation warnings in unchanged files.                                                                                                                                                        |
| `pnpm typecheck`                                                                                                                                                                                                                   | Passed across shared, swarm, web and mobile packages.                                                                                                                                                                                            |
| `pnpm web check:design-system`                                                                                                                                                                                                     | Passed: 70 adopted files.                                                                                                                                                                                                                        |
| `pnpm format:check`                                                                                                                                                                                                                | Started, then stopped with SIGINT/exit 130 after traversing unrelated `.claude/orchestrator/drafts` and reporting their existing formatting warnings. Not a clean unrestricted result; no unrelated files were reformatted.                      |
| `git ls-files -z \| xargs -0 pnpm exec prettier --check --ignore-unknown`                                                                                                                                                          | Passed for all tracked files. The final report was checked separately before commit.                                                                                                                                                             |
| `TZ=UTC pnpm test:unit --maxWorkers=2`                                                                                                                                                                                             | Passed: 213 files, 4,458 tests.                                                                                                                                                                                                                  |
| `TZ=Pacific/Pago_Pago pnpm test:unit --maxWorkers=2`                                                                                                                                                                               | Passed: 213 files, 4,458 tests.                                                                                                                                                                                                                  |
| `TEST_MONGODB_URI='mongodb://127.0.0.1:27018/?directConnection=true' pnpm test:integration --maxWorkers=2`                                                                                                                         | Passed: 36 files, 394 tests, 36.99 seconds.                                                                                                                                                                                                      |
| `AUTH_MODE=demo RECURRING_EXPENSES_ENABLED=true MONGODB_URI='mongodb://127.0.0.1:27018/splitbook_c322?directConnection=true' pnpm web demo:reset`                                                                                  | Passed; fresh fictional seed. Initial seed without recurring enabled also passed, then was replaced by this seed before browser checks.                                                                                                          |
| Scratch app `next build --webpack`, with demo production permissions, port-3322 origin and c322 database environment                                                                                                               | Passed after correcting scratch-only typecheck exclusions. Primary workspace typecheck remained enabled and passed.                                                                                                                              |
| `pnpm web exec playwright test --config /tmp/c322-demo.config.ts shortcuts.spec.ts expense-table.spec.ts expense-panel.spec.ts trip-summary.spec.ts group-insights.spec.ts group-insights-detail.spec.ts --workers=1`              | Passed: 106 tests, 30 intentional desktop/phone gesture/layout skips; 136 enumerated, 3.3 minutes. Real demo authentication and production `next start`, port 3322. Includes both Trip heading shortcut cases, Settings switch and axe journeys. |
| `DESIGN_BROWSER_WS=ws://127.0.0.1:9332/ pnpm web exec playwright test --config /tmp/c322-pilot.config.ts pilot.spec.ts --grep 'loaded presentation' --project desktop-light --project desktop-dark --update-snapshots --workers=1` | Passed: 4 images recorded, 4 tests, 34.2 seconds.                                                                                                                                                                                                |
| `DESIGN_BROWSER_WS=ws://127.0.0.1:9332/ pnpm web exec playwright test --config /tmp/c322-pilot.config.ts pilot.spec.ts --grep 'loaded presentation' --workers=1`                                                                   | Passed: all 8 desktop/phone light/dark comparisons and axe checks, 52.2 seconds. No snapshot-update flag.                                                                                                                                        |
| `git diff --check`                                                                                                                                                                                                                 | Passed.                                                                                                                                                                                                                                          |

Unit totals per timezone: shared 57 files/1,474 tests; swarm 6/122; web 69/842; mobile 81/2,020. Mobile checks ran without modifying mobile source or using an emulator.

The scratch build initially ran from the repository root and failed because that directory contains no Next app. A subsequent scratch build compiled but failed typecheck on test-only relative paths not copied into `/tmp/c322-web`. Restricting the scratch tsconfig to app source and generated Next types, excluding test-only files, produced a clean production build; the full repository typecheck separately covered those tests. These were runner setup failures, not product fixes. GitHub's default issue-view query also failed on deprecated projectCards; explicit JSON fields successfully read both specs.

The entire demo suite was not run: the rebase required only the conflicts listed by the owner. The requested six specs passed, with no failures requiring broader reruns. Additional CI timezone/browser coverage remains for the required `full-ci` label.

## Baselines and visual verification

Started the owned `c322-visual-browser` container using `docker run --rm -d --name c322-visual-browser -p 9332:9332 mcr.microsoft.com/playwright:v1.62.1-noble /bin/sh -c 'npx -y playwright@1.62.1 run-server --port 9332 --host 0.0.0.0'`. It ran the same Linux Chromium version as CI, remotely connected from the host runner. Docker warned about amd64 emulation on this arm64 host; all recording and comparison tests passed.

Only these four baselines changed, in the separate screenshot commit:

- `apps/web/playwright-pilot/snapshots/desktop-light/dashboard.png`
- `apps/web/playwright-pilot/snapshots/desktop-dark/dashboard.png`
- `apps/web/playwright-pilot/snapshots/desktop-light/balances.png`
- `apps/web/playwright-pilot/snapshots/desktop-dark/balances.png`

The N hint widens Add expense and moves the demo badge/theme control left. Dimensions remain 1280×1124 for dashboard and 1280×1540 for balances. Pixel comparison against main shows approximately 4,300 changed pixels in the top bar and only a few isolated edge pixels elsewhere (at most 56 outside the top bar per image). Visual inspection of the light dashboard and dark balances confirmed no content or layout loss. All four phone baseline files are byte-for-byte unchanged from main; all eight compare-only checks passed. Statement print baselines were untouched.

## Standards

Documented violations: 0. Independent review compared `d49de573...HEAD` through `af0d8c8` and `fbc9e59` with AGENTS.md, CONTEXT.md, docs/ui.md, docs/testing.md and ADR 0002. New controls use MUI/sx and semantic colors; native button and Tab behavior remains accessible. Browser-only logic remains in web. The React checklist found no actionable duplicated listener, stale handler or hydration concern. No actionable Fowler heuristic findings. Tool-enforced formatting, lint and type issues were excluded.

Standards total: 0 findings; no unresolved issue.

## Spec

Independent review found 0 confirmed defects, 0 missing requirements and 0 scope additions. The owner's no-X decision overrides the original issue. Provider, matching table, member setting, modifier search, page shortcuts, table-focus shortcuts, desktop hints, footer Settings link and no-panel-E-hint behavior match the handoff. Trip headings and the dayHeadings memo remain intact, with the new heading-skipping/Tab/Enter test. No mobile changes.

Spec total: 0 findings; no unresolved issue. Review did not itself claim verification commands passed; their actual results are listed separately above.

## Cleanup

Dropped only `splitbook_c322` through MongoClient at `mongodb://127.0.0.1:27018/?directConnection=true`; result `true`. Stopped only `c322-visual-browser` (`--rm` removes it); retained the existing `splitbook-mongo` container. Runner-owned port-3322 servers exited with the tests. Removed seven `/tmp/c322-*` scratch paths after retaining the runner configs and logs, plus the root `.next/trace` and `.next/trace-build` created by the first misplaced build. The real app's `apps/web/.next` output was preserved.

Final cleanup checks confirmed no listener on 3322/9332, no c322 database and no task scratch paths. Only pre-existing/untracked `output/` remains outside tracked work, now also holding this task's evidence and PR draft. No branches were deleted. Never used host 27017, port 3100, backend 4138 or the Android emulator.

## Publishing follow-up: 9 October 2026

The owner subsequently authorized another interactive browser check, pushing the branch and preparing a PR for merge. Rebased onto `e0d9d0c712f749699b58e1ac542ed744ac61598f` (the merged #319 whole-Trip Payments fix) without conflicts. `git range-diff d49de573..3716b47 e0d9d0c..fba5c16` shows all four original commits unchanged apart from their rebased hashes: `5a9eb6b`, `2fd6585`, `d533ee7`, `fba5c16`.

Used a managed worktree at `/Users/ankitdas/.codex/worktrees/shortcuts-322-publish/SplidBook`; primary local `main` stays unchanged. Installed all 913 locked packages offline with the existing pnpm 10.23.0 executable after correcting the worktree's executable PATH. No lockfile changes.

`pnpm swarm up --origin http://127.0.0.1:3322 --server production --mongo-port 27018 --ready-timeout 600` passed, including the full production build/typecheck, in 32.4 seconds. It created only its own fictional database `splitbook_mobile_swarm_6250b7446a_b7b9240a`.

The Codex in-app browser, signed in as fictional Alex, confirmed:

- N opens the Group chooser on Home.
- / opens global search outside a Group, focuses Group search within one, and moves from Balances to Expenses with search focused.
- / types literal text while in a search field.
- J skips Day 4's heading from houseboat to Dinner; K moves back to houseboat.
- Enter opens the focused row and closes that same row again.
- E opens the correct Expense form; Cancel preserves the ledger.
- Settings turns single keys off and keeps that choice after reload; N and / open no dialog, J retains row focus and E opens no form.
- Tab reaches the next Expense and Enter opens it with single keys off; ⌘K still opens global search.
- The setting was restored; light and dark Settings, Trip day headings, row controls and footer were visually inspected.

Browser screenshots are retained in the primary checkout's `output/playwright/c322-publish/`: `settings.jpg`, `settings-dark.jpg`, `trip-dark.jpg`. No real account or production data was used and no Expense or Payment was saved. Prior two-axis review findings remain zero; this rebase changed no reviewed feature code. The pre-push `pnpm swarm gate` and GitHub `full-ci` results belong to the publication follow-up and are reported in the final PR status.

## Final PR draft

Title: **Web: keyboard shortcuts with a Settings switch (#322)**

Closes #322. Part of #300.

Needs the `full-ci` label: this changes the signed-in shell and adds a Playwright journey, which ordinary PR checks do not run.

Adds one shortcut table for key handling and hints, a signed-in provider, and a per-member Settings switch stored on this device. N opens Add expense; / focuses Group search; ⌘K / Ctrl+K keeps working when single keys are off. While the Expense table has focus, J/K move, Enter toggles the side panel, and E edits. Single keys pause while typing, composing text, or using a dialog or menu.

Rebased onto current main, preserving Insights, exports, printable statements, Trip day headings and day totals. The new Trip journey verifies J/K cross heading rows in both directions, boundary behavior, Tab access and Enter toggling.

Decisions for review:

- X is left out because row selection and bulk actions are deferred.
- Focus moves between the rows’ own buttons; every row retains its Tab stop.
- Outside a Group, / opens ⌘K search across Groups.
- There is no E hint on the panel because E applies only while the table has focus.
- The Expenses footer links to Settings.
- Enter on an open row closes it, matching a click on its button.

Verification: workspace lint/typecheck, design-system policy, tracked-file formatting, unit tests in UTC and Pacific/Pago_Pago, real-Mongo integration, production browser journeys and Linux baseline comparisons. Exact counts and formatting limitations are recorded in docs/qa/2026-10-09-keyboard-shortcuts.md. Desktop dashboard and balances baselines were re-recorded separately; phone baselines are unchanged.

🤖 Generated with Claude Code
