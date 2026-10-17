Closes #322. Part of #300.

Needs the `full-ci` label (applied): this changes the signed-in shell and adds a Playwright journey, which ordinary PR checks do not run.

Adds one shortcut table for handling and hints, a signed-in provider, and a per-member Settings switch stored on this device. N opens Add expense; / focuses Group search; ⌘K / Ctrl+K keeps working when single keys are off. While the Expense table has focus, J/K move, Enter toggles the side panel, and E edits. Single keys pause while typing, composing text, or using a dialog or menu.

Rebased onto current main (`e0d9d0c`), preserving Insights, exports, printable statements and whole-Trip Payments, Trip day headings and day totals. A Trip regression verifies J/K cross heading rows in both directions, boundary behavior, Tab access and Enter toggling. Four desktop dashboard/balances images were re-recorded in CI's Linux Playwright 1.62.1 container; phone baselines are unchanged.

Decisions for review:

- X is left out because row selection and bulk actions are deferred.
- Focus moves between the rows’ own buttons; every row retains its Tab stop.
- Outside a Group, / opens ⌘K search across Groups.
- There is no E hint on the panel because E applies only while the table has focus.
- The Expenses footer links to Settings.
- Enter on an open row closes it, matching a click on its button.

Verification:

- Interactive Codex in-app browser on a production build with fictional Alex: N, /, heading-skipping J/K, Enter open/close, E with Cancel, the persisted switch, single keys disabled, native Tab/Enter access retained, ⌘K retained, Balances-to-search handoff and light/dark visual checks passed. No ledger changes were saved.
- Local pre-push `pnpm swarm gate --mongo-port 27018 --base origin/main`: PASS at `0f6eed8`, all 16 steps in 127.2 seconds: install, lint, typecheck, full formatting, 4,459 unit tests, ceilings, production backend and all 9 HTTP verifiers.
- Earlier complete branch verification: unit tests in UTC and Pacific/Pago_Pago (4,458 tests each), real-Mongo integration (394 tests), production browser journeys (106 passed, 30 intentional skips), Linux desktop recording (4 passed) and all-project compare-only (8 passed).
- GitHub browser CI: demo journeys 358 passed / 42 intentional skips; Google sign-in 7 passed; component lab 20 passed; pilot behavior/accessibility/visual comparisons 68 passed; production lab exclusion 1 passed. No browser retries or flaky cases reported.
- GitHub `full-ci` completed successfully at `0f6eed8`: 4,856 workspace unit/integration tests (248 files), 239 authenticated expense-access cases, 4 Google sign-in recovery cases, all three timezone jobs, all HTTP verifiers, static checks and production builds passed. [CI run](https://github.com/FireBird1998/splitbook/actions/runs/37958736371).
- Initial CI attempt: the existing mobile test for cancelling scroll restoration after a Month change failed. The same assertion also failed for its drag case on main before this PR ([main run](https://github.com/FireBird1998/splitbook/actions/runs/37957049976)). The verification job passed on one retry; 10 consecutive targeted local reruns and the full 2,020-test mobile suite also passed. This intermittent test remains a known limitation; no mobile files were changed.
- Independent Standards and Spec reviews: zero findings. The final rebase changed no feature code.

Exact commands, resolved conflicts, results and earlier runner limitations are in [the verification report](https://github.com/FireBird1998/splitbook/blob/codex/322-shortcuts/docs/qa/2026-10-09-keyboard-shortcuts.md). No server or mobile source changes; no deployment requested.

🤖 Generated with Claude Code
