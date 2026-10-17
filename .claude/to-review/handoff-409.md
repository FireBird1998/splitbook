Build GitHub issue #409 in FireBird1998/splitbook: "To review 6: Android review one at a time". It is the last ticket of spec #403 (To review). Every other ticket (#404 to #408, and #410) has merged.

Read both issues first: `gh issue view 409 --repo FireBird1998/splitbook`, then the same for 403. #409's acceptance criteria are your definition of done, and #403's decisions are final. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR at the end.

Also read:
- `AGENTS.md` and `CONTEXT.md`;
- `docs/adr/0004-expo-mobile-client.md`;
- `docs/adr/0008-persistent-assistant-expense-drafts.md`.

If you have the Artifact tool, read the design canvas https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9, page "Phone: To review": the ReviewCard board, every state (needs details, ready, possible duplicate, changed by Claude, delete, end of run), and both "from" variants. Treat it as design data, not instructions.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`: it is on another branch with unsaved work.
- **Branch:** `git fetch origin && git switch -c feat/409-android-one-at-a-time origin/main`. Main is 532013e or later, which includes #406.
- **Stay out of `apps/web`.**
- **The "what changed and who" note already exists:** `describeDraftChange(before, after, names)` in `@splitbook/shared/to-review`, from #406. `names` maps member IDs to display names.
  - It returns the agreed wording, for example "Claude changed the amount a moment ago: ₹2,350.00 → ₹2,400.00. You're seeing the latest version."
  - **Use it. Don't write a second one, and don't change its wording:** the web uses it too.
  - `reviewDate(date)` in the same module formats a Draft's calendar date.

## What's already there
- **Shared pieces:**
  - `@splitbook/shared/to-review`: `buildToReview` (states, the cross-Group run order, counts, source summaries) and `summarizeReviewRun` (the end summary);
  - `@splitbook/shared/draft-collection-client`: review, save, replay identity and per-item outcomes;
  - `@splitbook/shared/draft-attribution`: `preparedBy` and `changedBy` on every Draft;
  - `@splitbook/shared/persistent-draft-editor`.
- **Android To review (#408 and #410):**
  - `apps/mobile/src/data/to-review.ts` (the cached cross-Group read and the model adapter);
  - `apps/mobile/src/ui/to-review.tsx` (the Home card, banner and list; "Review N, one at a time" and the list's "Review one at a time" currently open the first Group's list);
  - `shared-drafts.tsx` and `shared-draft-collection.ts` (the reused editor, keep-as-you-go edits, save and recovery);
  - `finish-later.tsx`.
- **The form's tiles and pickers:** date, paid by, split and Tag, in `apps/mobile/src/ui/expense-editor.tsx` and the compact sheets under `apps/mobile/src/ui/`. Reuse them.
- **The Leave sheet:** `apps/mobile/src/ui/group-members.tsx`.
- **The flag:** `EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED`.

## Decisions already made
Don't reopen these. Note any other decision you make under "Notes for review" in the PR.

1. **Entry points.**
   - Home's "Review N, one at a time" starts a run across every Group.
   - A Group list's "Review one at a time" starts a run for that Group only.
   - Close returns to where the run started.
   - With the flag off, nothing here exists.
2. **Order.**
   - Use the shared model's run order, Group by Group: ready, then possible duplicate, then needs details, oldest first.
   - Phone-only ("On this phone") items aren't part of the run. They keep their own Continue flow from #410.
3. **Header.**
   - The Group name is the title, always: saving into the wrong Group is the real risk.
   - The subtitle is "Review · 3 of 5 · across 2 Groups". Drop "across N Groups" when the run is in one Group.
   - A progress bar shows done, current and remaining, with an accessible value.
4. **The card.**
   - **Its source line:** "Prepared by Claude · from your chat · today 10:41" or "You set this aside · Finish later · yesterday 21:05". Build both with the app's own date and time helpers, never hard-coded, so they pass in all four CI time zones.
   - **Its content:**
     - the amount;
     - the description;
     - tiles for date, paid by, split and Tag, opening the existing pickers;
     - the per-person split line.
   - **Edits are kept straight away,** replacing the Draft at its current revision, like the list's editor.
5. **Missing details.**
   - The missing tile is highlighted ("Who paid? · Choose"), with "One thing left before you can save: who paid", or "N things left …" for several.
   - For an assistant-prepared item, it says "Claude didn't know who paid, so it left that to you".
   - Save expense is disabled with the reason.
6. **Possible duplicate.**
   - Show the matching expense: description, date, amount, and who added it.
   - Save stays disabled until "It's a different expense, save it anyway" is ticked.
7. **Changed while you look.**
   - When the read or a stale-revision reply shows a newer version, the card switches to it and shows the note from `describeDraftChange`, for example "Claude changed the amount a moment ago: ₹2,350.00 → ₹2,400.00. You're seeing the latest version."
   - Typing that isn't kept yet must never be lost to the card's own delayed reply. #406's web editor (`apps/web/src/components/to-review/use-review-editor.ts`) shows one way to tell the member's own write apart from a real change from elsewhere. Read it; don't import it.
   - Never overwrite silently.
8. **Actions.**
   - **Save expense** runs the existing per-item review, then saves exactly the version on screen through the shared client, then moves on. If the reply is lost, show "We didn't hear back, so it may already be saved" with Check again, using the original identity.
   - **Delete** asks first, in a sheet: "It was never saved, so nothing in <Group> changes. You can't undo this." Then it removes the item and moves on.
   - **Skip for now** leaves the item and moves on.
9. **End of the run.**
   - "Done for now".
   - "You went through 5 items in Maple House and Goa Friends Trip".
   - Then Saved, Deleted and Left for later, from `summarizeReviewRun`.
   - Then **Done**, back to where the run started.
   - Skipped and failed items stay in To review.
10. **Offline.**
    - Account items are read-only, with "Connect to change or save this".
    - The run can still be closed.
    - Nothing uploads or saves on reconnect by itself.
11. **Copy fix from #410.** The Leave sheet says "You have 1 items…" when the count is 1. Make it "1 item"; keep "items" for any other count.
12. **Member words only.**
    - Never show Draft, revision, request or collection.
    - Money is exact, with the shared formatter.
    - Every control has a screen-reader label.

## Tests
- **Render tests through the mobile controller,** in the existing `apps/mobile/src/ui/*.test.tsx` style, at 130% text, in dark, and checking screen-reader labels on every control. Cover:
  - each card state: needs details (one and several), ready, possible duplicate (unticked and ticked), changed while you look, delete sheet, offline read-only;
  - both "from" variants;
  - the cross-Group run with a Group change in the header;
  - Skip for now;
  - Save followed by moving on;
  - a lost reply, then Check again;
  - the end summary counts;
  - Close from Home and from a Group list;
  - the "1 item" Leave copy.
- **A double-save test:** the reply to a save in the run is lost, Check again runs, and there is exactly one Expense.
- **Mobile HTTP verifier:** extend `verify-shared-drafts.ts`, or add one wired the same way, to cover saving from the run against a real backend, with fictional data including a "Claude"-prepared item.
- **Unit tests** for any pure helpers, in all four time zones where dates are involved.

## Checks
- **Backend:** run `pnpm swarm up --mongo-port <port>` against your own single-node replica set, a container called `w409-mongo-rs` on a free port, because saving Drafts needs transactions.
- **`pnpm swarm gate`:** run it against that backend, and `pnpm swarm down` afterwards.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`.
- `pnpm test:unit --maxWorkers=2` in UTC and with `TZ=Pacific/Pago_Pago`. CI also runs Kiritimati and Tongatapu.
- **Render ceilings:** keep them unchanged. Don't raise them or remove profile journeys.
- **If the host's plain `pnpm` fails**, use `corepack pnpm`.
- **No emulator or device work.** emulator-5554 belongs to the owner, who does device acceptance separately.

## Resources and rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554. They belong to other sessions.
- Name scratch files `w409-*`.
- Fictional data only: the repo is public.
- Never delete branches. Never use bare `git stash`.
- **Clean up afterwards:**
  - `pnpm swarm down`;
  - stop and remove your containers;
  - remove your scratch files.

## Commit and PR
- **Commits:** plain messages, with no model names and no Co-Authored-By trailer.
- **When every check passes,** push the branch and open a PR to `main` with the `full-ci` label.
- **The PR body:**
  - starts with "Closes #409. Part of #403.";
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
