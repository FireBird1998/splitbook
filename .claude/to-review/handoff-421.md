Build GitHub issue #421 in FireBird1998/splitbook: "To review fix 3: web To review polish (Save N ready, counts, Home card)". It is part of spec #418. #419 and #420 have merged.

Read #421 and #418 first, with `gh issue view <n> --repo FireBird1998/splitbook`. #421's acceptance criteria are your definition of done. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`.
- **Branch:** `git fetch origin && git switch -c fix/421-to-review-polish origin/main`. Main is 8d05ba4 or later, which includes #422 and #423.

## Where things are (on 8d05ba4)
- **`apps/web/src/components/to-review/ToReviewPage.tsx`:**
  - "Save N ready" is disabled while an item is open: `disabled={busy || pending || !available || !!selected || !!run}`, around line 346. A similar condition is around line 413.
  - The summary prints `{model.counts.needsDetails} needs details` (around line 327) in addition to the summary line, so "1 needs details" appears twice.
- **`apps/web/src/components/to-review/use-review-editor.ts`:** `flush()` keeps pending typing. Save, Next, Skip and Close already flush before acting.
- **`apps/web/src/components/to-review/ToReviewCard.tsx`:** the Home card returns `null` only once the read is ready and empty. While loading, it renders a "To review" card with a skeleton. `ToReviewBanner.tsx` already renders nothing while loading; match it.

## Decisions already made
1. **"Save N ready" while an item is open:**
   - stays enabled;
   - on press, it flushes the open item's pending edit first;
   - if the flush fails, it shows the panel's usual error and stops;
   - otherwise it runs the normal review and confirmation for exactly the ready versions, including the version just kept.
   - Don't close the panel unless the confirmation flow needs it; keep focus sensible.
2. **Nothing ready:** "Save N ready" isn't rendered at 0. "Review one at a time" stays when items remain.
3. **Counts once:** each count appears once in the summary.
4. **The Home card** renders nothing until the read is ready with at least one item. Keep its error state for a failed read only if it already shows one; don't flash anything while loading.

## Tests
- **Playwright on the demo seed,** with `playwright/to-review-seed.ts`:
  - with an item open and an edit just typed, Save N ready keeps the edit and the confirmation shows the kept value;
  - with zero ready items, there's no Save N ready button;
  - no repeated count;
  - Home with nothing waiting never shows a To review card while loading (check before the read resolves, for example by delaying the route);
  - light and dark at 130% text, with axe.

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm web check:design-system`.
- `pnpm test:unit --maxWorkers=2` in UTC and `TZ=Pacific/Pago_Pago`.
- **Demo browser suite:** port 3421, database `splitbook_w421`, `--workers=1`, a production build, both draft flags on, on your own single-node replica set.
  - Add `splitbook_w421` to the demo-database lists in `to-review-seed.ts` and `finish-later.spec.ts`.
- **Expense-access suite:** `pnpm web test:expense-access` on your own replica set, with `EXPENSE_ACCESS_MONGO_PORT=<port>`. It must pass.
- **If plain `pnpm` fails**, use `corepack pnpm`.

## Rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554.
- Fictional data only. Never delete branches. Never use bare `git stash`.
- **Clean up** your containers afterwards.
- **Commits:** plain, with no model names and no Co-Authored-By trailer.
- **The PR:** when the checks pass, push and open it to `main` with the `full-ci` label.
  - The body starts with "Closes #421. Part of #418." and has a "Notes for review" section.
  - It ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **Editing the body later:** use `gh api -X PATCH repos/FireBird1998/splitbook/pulls/<n> -F body=@<file>`.
- **Don't merge.**
