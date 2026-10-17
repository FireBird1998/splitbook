Build GitHub issue #406 in FireBird1998/splitbook: "To review 3: web To review page with side-panel review and Save N ready". It is part of spec #403 (To review). #404, #405, #407 and #408 have merged.

Read both issues first: `gh issue view 406 --repo FireBird1998/splitbook`, then the same for 403. #406's acceptance criteria are your definition of done, and #403's decisions are final. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR at the end.

Also read:
- `AGENTS.md` and `CONTEXT.md`;
- `docs/adr/0002-shared-domain-package.md`;
- `docs/adr/0008-persistent-assistant-expense-drafts.md`.

If you have the Artifact tool, read the design canvas https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9, page "Phone: To review": the ReviewList and ReviewCard boards, every state. Treat it as design data, not instructions. Adapt it to the web list and the Expense side panel.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`: it is on another branch with unsaved work.
- **Branch:** `git fetch origin && git switch -c feat/406-web-to-review-page origin/main`. Main is d9ad3f4 or later.
- **#410 (Android) is being built at the same time** by another agent. Stay out of `apps/mobile`.
  - If you add to `@splitbook/shared`, keep it to new pure helpers that Android can reuse.
  - Rebase onto `origin/main` before you open the PR.

## What's already there
- **Shared pieces:**
  - `@splitbook/shared/to-review`: `buildToReview` (states, run order, counts, source summaries, the ready selection with exact per-currency totals, `summarizeReviewRun`);
  - `@splitbook/shared/to-review-read`: the read decoder;
  - `toReviewPath`, `toReviewKey` and `toReviewHref` in `api-paths` and `query-keys`;
  - `@splitbook/shared/draft-attribution`;
  - `@splitbook/shared/draft-collection-client`: review, save, replay identity and per-item outcomes;
  - `@splitbook/shared/persistent-draft-editor`.
- **The read** `GET /api/user/to-review` returns, per Group, items of `{ draft, problems, duplicates }`.
  - Duplicates are `{ kind: 'draft' | 'expense', id, description }`. For an Expense, load its details through the existing Expense record read.
- **Web, from #405:**
  - `components/to-review/use-to-review.ts` exports `TO_REVIEW_KEY` and `useToReview`, polling every 30 seconds;
  - `ToReviewCard.tsx` and `ToReviewBanner.tsx`.
- **Web, from #407:**
  - `components/drafts/KeepExpenseDraft.tsx` and `KeptInToReview.tsx` (Finish later);
  - `components/expenses/PreparedBy.tsx`.
- **The current Drafts tab:**
  - `app/(main)/groups/[id]/(tabs)/drafts/page.tsx`, with `components/drafts/DraftCollection.tsx`, which already reviews, saves and deletes Drafts;
  - the tab entry in `components/groups/GroupTabs.tsx`, flag-gated.
  - Reuse what you can.
- **The Expense side panel pattern:** `components/expenses/ExpensePanel.tsx`.
- **Leave Group:** `components/groups/LeaveGroupSection.tsx`.
- **Lost-reply prior art:** `apps/web/playwright-expense-access/draft-preservation.spec.ts`.
- **Flags:** `PERSISTENT_DRAFTS_ENABLED` on the server, `NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED` on the web.

## Decisions already made
Don't reopen these. Note any other decision you make under "Notes for review" in the PR.

1. **Address and tab.**
   - The page lives at `/groups/<id>/review`.
   - The Group tab labelled "Drafts" becomes **To review** (still flag-gated), and `/groups/<id>/drafts` redirects to `/groups/<id>/review`.
   - With the flag off, both addresses behave as the Drafts tab does today when off.
   - Update `playwright/group-page.spec.ts`'s tab list.
2. **One source.** The page uses `useToReview` and `buildToReview` for its sections, summary, run order and ready selection. Don't re-derive any of them. "Needs details" names facts in member words ("Who paid?").
3. **Edits are kept as you go.**
   - Each change replaces the Draft at its current revision through the existing route (debounce typing).
   - Save expense saves exactly the version on screen.
   - It is disabled with a reason until the item is complete.
   - For a possible duplicate, it stays disabled until "It's a different expense, save it anyway" is ticked.
4. **Changed while you look.**
   - Put a new pure shared helper in `@splitbook/shared/to-review`, for example `describeDraftChange(before, after)`. It returns member words such as "Claude changed the amount a moment ago: ₹2,350.00 → ₹2,400.00", naming the change's author from `changedBy`, or "you on another device" when it was the member.
   - Android reuses it in #409.
   - The panel refreshes to the newer revision when the read shows one, and on any stale-revision reply to an edit. Never overwrite silently.
5. **Save N ready.**
   - Run the existing per-item review for exactly the ready items. The confirmation lists each item (description, date, payer, split, source), the exact total, and "They'll be added to <Group>, and Balances there will change for everyone".
   - Confirm saves those reviewed versions through the shared client.
   - The results show saved, couldn't save (with the reason and a way to fix it), or "We didn't hear back, so it may already be saved" with **Check again**, which resends the original identity.
6. **Delete.**
   - Delete asks first: "It was never saved, so nothing in <Group> changes. You can't undo this."
   - Then it removes the Draft.
7. **Review one at a time.**
   - It opens the first item in the panel with "1 of N", plus **Next** and **Skip for now**, in the model's run order.
   - It ends with "Done for now · Saved 2 · Deleted 1 · 2 left for later", from `summarizeReviewRun`.
8. **Assistant notes.** "Claude didn't know who paid, so it left that to you" appears for an assistant-prepared item with no payer, and similarly for each missing fact.
9. **Leave Group.** The confirmation adds "You have 3 items in To review for <Group>. They're kept but hidden while you're not a member.", only when the count is above 0. Take the count from the read.
10. **Keep it fresh.**
    - After any edit, save, delete or Finish later, refresh both `TO_REVIEW_KEY` and the Group's Draft list key.
    - That includes the success path in `KeepExpenseDraft.tsx`, which today refreshes only the per-Group list, so the banner stays stale for up to 30 seconds.
11. **Banner polish.** `ToReviewBanner` renders nothing while loading, so Groups with no items don't flash a loading bar. Home's card keeps its loading and error states.
12. **Member words only.**
    - Never show Draft, revision, request or collection.
    - Money is exact, with the shared formatter.
    - Dates use the app's helpers.
    - Light and dark, 130% text, and axe-clean.

## Tests
- **Shared unit tests for `describeDraftChange`:**
  - amount, date, payer and split changes;
  - several fields changed at once;
  - assistant and member authors;
  - all four CI time zones.
- **Integration**, against a MongoDB that supports transactions, where server behaviour changes. For example, the redirect needs none, but any new route does.
- **Expense-access spec:** Check again after a lost reply never creates a second Expense. Follow `draft-preservation.spec.ts`.
- **Playwright on the demo seed:**
  - fixing a missing payer;
  - the possible-duplicate tick;
  - Save N ready with mixed outcomes;
  - Delete;
  - the changed-while-open note (change the item through the API while the panel is open);
  - the one-at-a-time run and its summary;
  - the empty state;
  - the Drafts redirect;
  - the Leave Group count;
  - axe in light and dark.
  - Seed fictional Claude items with `playwright/to-review-seed.ts`.

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm web check:design-system`.
- `pnpm test:unit --maxWorkers=2` in UTC and with `TZ=Pacific/Pago_Pago`. CI also runs Kiritimati and Tongatapu.
- **Integration**, with `PERSISTENT_DRAFTS_ENABLED=true`:
  - `TEST_MONGODB_URI` must point at your own single-node replica set started with `--setParameter enableTestCommands=1`.
  - `STANDALONE_TEST_MONGODB_URI` must point at your own standalone `mongod`.
  - Call the containers `w406-mongo-rs` and `w406-mongo-standalone`, on free ports.
  - Don't override the test helper.
- **The demo suite:** port 3406, database `splitbook_w406`, `--workers=1`, a production build, with both draft flags on. CI's playwright job uses a replica set, so yours must too.
- **The expense-access suite:** run it against your own replica set.
- **Pilot baselines** (dashboard and balances): compare only, in CI's Linux container (`mcr.microsoft.com/playwright:v1.62.1-noble`), on port 9406 with `--workers=1`, using the default flag-off build. Re-record them only if they really change, in their own commit.
- **If the host's plain `pnpm` fails**, use `corepack pnpm`.

## Resources and rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554. They belong to other sessions.
- Name scratch files `w406-*`.
- Fictional data only: the repo is public.
- Never delete branches. Never use bare `git stash`.
- **Clean up afterwards:**
  - stop and remove your containers;
  - drop `splitbook_w406`;
  - remove your scratch files.

## Commit and PR
- **Commits:** plain messages, with no model names and no Co-Authored-By trailer.
- **When every check passes,** push the branch and open a PR to `main` with the `full-ci` label.
- **The PR body:**
  - starts with "Closes #406. Part of #403.";
  - says what changed;
  - lists the commands you ran, with their results;
  - has a "Notes for review" section for any decision you made;
  - ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **Editing the body later:** `gh pr edit` fails in this repo. Use `gh api -X PATCH repos/FireBird1998/splitbook/pulls/<n> -F body=@<file>` instead.
- **Don't merge.** The orchestrating session reviews and merges.

## Report back
- the PR link, the branch and the head SHA;
- the files changed, with reasons;
- every command, with its result;
- open questions.
