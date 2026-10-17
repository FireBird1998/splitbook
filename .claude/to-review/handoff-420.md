Build GitHub issue #420 in FireBird1998/splitbook: "To review fix 2: web review panel uses the Add expense pickers and member words". It is part of spec #418, the To review staging fixes; the parent feature is #403. #421, the web polish, waits on this ticket.

Read #420 and #418 first, with `gh issue view <n> --repo FireBird1998/splitbook`. #420's acceptance criteria are your definition of done. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`.
- **Branch:** `git fetch origin && git switch -c fix/420-review-panel-pickers origin/main`. Main is 272486f or later.
- **Another agent is building #419 at the same time.** It changes the MCP connection and the `/mcp/consent` page. Stay out of `apps/web/src/lib/mcp/` and `apps/web/src/components/mcp/`.

## What's wrong (found on staging, 2026-10-15)
The web To review side panel is a raw editor:
- labels like "Currency (e.g. INR)" and "Date (YYYY-MM-DD)", and lowercase values like "other" and "equal";
- problems shown with field paths, such as "Who paid?.0.amount: Enter the amount paid by this member.". These come from the word-swapping helper `reviewProblem` in `components/to-review/review-client.ts`.

## Where things are
- **To review web:** `apps/web/src/components/to-review/`. That's `ToReviewPanel.tsx`, `ReviewDetails.tsx`, `use-review-editor.ts` (edits kept as you go, version handling, the change note), `ToReviewPage.tsx` and `review-client.ts`.
- **The Add expense form to reuse:** `apps/web/src/components/expenses/ExpenseFormDialog.tsx` and `expense-form-helpers.ts`. `ExpensePanel.tsx` is the side-panel pattern.
- **The shared model's member words:** `@splitbook/shared/to-review`, which handles missing facts ("Who paid?") and `describeDraftChange`.

## Decisions already made
1. **Reuse the form's pickers.** The panel uses the Add expense form's amount, description, date, paid by, split and Tag pickers, plus its optional details. Prefer extracting the shared field block from the form over copying it, and keep the form's own behaviour unchanged.
2. **Keep everything the panel does now:**
   - edits are kept against the current version as you go (debounced, serialized);
   - the "what changed and who" note;
   - Save expense saves exactly the version shown;
   - Save is disabled with a reason for missing details or an unticked duplicate;
   - Delete asks first;
   - the one-at-a-time run.
3. **Problems in member words.**
   - Show problems from the shared model's member wording, for example "Who paid?" or "The amount paid by Ankit Das?".
   - Never show server messages that carry field paths.
   - Add any missing wording to the shared model, so Android can reuse it, and replace `reviewProblem`'s string substitution.
4. **No page-level changes.** "Save N ready", the counts and the Home card are #421's.

## Tests
- **Shared unit tests** for any new member wording, in all four CI time zones.
- **Playwright on the demo seed:**
  - fix a missing payer with the payer picker, and change the date with the date picker; both are kept and the item moves to Ready;
  - no "(e.g. INR)", "(YYYY-MM-DD)", raw values or field paths anywhere on the page;
  - the existing To review journeys still pass;
  - light and dark at 130% text, with axe.
  - Seed items with `playwright/to-review-seed.ts`.

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm web check:design-system`.
- `pnpm test:unit --maxWorkers=2` in UTC and `TZ=Pacific/Pago_Pago`.
- **Integration**, with `PERSISTENT_DRAFTS_ENABLED=true`:
  - `TEST_MONGODB_URI` must point at your own single-node replica set with `--setParameter enableTestCommands=1`;
  - `STANDALONE_TEST_MONGODB_URI` must point at your own standalone;
  - call the containers `w420-*`, on free ports.
- **Demo browser suite:** port 3420, database `splitbook_w420`, `--workers=1`, a production build, both draft flags on.
- **Pilot baselines:** compare only, in `mcr.microsoft.com/playwright:v1.62.1-noble` on port 9420.
- **If plain `pnpm` fails**, use `corepack pnpm`.

## Rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554.
- Fictional data only. Never delete branches. Never use bare `git stash`.
- **Clean up** your containers and databases afterwards.
- **Commits:** plain, with no model names and no Co-Authored-By trailer.
- **The PR:** when the checks pass, push and open it to `main` with the `full-ci` label.
  - The body starts with "Closes #420. Part of #418." and has a "Notes for review" section.
  - It ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **Editing the body later:** use `gh api -X PATCH repos/FireBird1998/splitbook/pulls/<n> -F body=@<file>`.
- **Don't merge.**
