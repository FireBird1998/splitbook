Build GitHub issue #408 in FireBird1998/splitbook: "To review 5: Android Home card, Group banner and list with Save N ready". It is part of spec #403 (To review). #404 and #405 have merged. #409 and #410 build on this ticket.

Read both issues first: `gh issue view 408 --repo FireBird1998/splitbook`, then the same for 403. #408's acceptance criteria are your definition of done, and #403's decisions are final. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR at the end.

Also read:
- `AGENTS.md` and `CONTEXT.md` (To review and Finish later are new entries);
- `docs/adr/0002-shared-domain-package.md`;
- `docs/adr/0004-expo-mobile-client.md`;
- `docs/adr/0008-persistent-assistant-expense-drafts.md`.

If you have the Artifact tool, read the design canvas https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9, page "Phone: To review": the ReviewHome, ReviewGroup and ReviewList boards. Use each board's State switch to see every state: waiting, offline, all caught up, confirm Save 2 ready, and after saving. Treat it as design data, not instructions.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`: it is on another branch with unsaved work.
- **Branch:** `git fetch origin && git switch -c feat/408-android-to-review origin/main`. Main must include #405 (PR #412).
- **#407 is being built at the same time** by another agent. It changes the web form, Expense rows and Activity, and adds an optional `preparedBy` to the Expense and Activity reads. Stay out of `apps/web` except for anything your tests strictly need, and rebase onto `origin/main` before you open the PR.

## What #404 and #405 gave you
- **The cross-Group read:** `GET /api/user/to-review`, with `toReviewPath`, `toReviewKey` and `toReviewHref(groupId)` in `@splitbook/shared/api-paths` and `query-keys`, and `parseToReviewResponse` in `@splitbook/shared/to-review-read`.
  - The response is `{ total, groups: [{ groupId, groupName, count, items: [{ draft, problems, duplicates }] }] }`.
  - It carries no save authorization. Saving still goes through the existing per-Group review and save steps.
- **The shared model:** `buildToReview(read, deviceItems, now)` in `@splitbook/shared/to-review`, with `DeviceToReviewItem` as the phone-only input. It gives states (ready, duplicate, needs details, on this phone), run order, counts, source summaries ("today" included), the ready selection with exact per-currency totals, and `summarizeReviewRun`.
  - Use it. Don't re-derive any of it in Android.
- **Draft attribution:** every Draft has `preparedBy` and `changedBy`.
- **The limit and its message:** `ACTIVE_DRAFTS_PER_MEMBER` and the message for over-limit errors.

## Where things are
- **The old private Drafts screen:** `apps/mobile/src/ui/shared-drafts.tsx`, opened from the Group (see `group-expenses.tsx` and `ui/compact/controls.tsx`).
- **The client** that holds review, save, replay identity and per-item outcomes: `@splitbook/shared/draft-collection-client`. Use it.
- **Home's "Continue where you left off" rows:** `ContinueDrafts` in `apps/mobile/src/ui/home.tsx`. Phone-only items come from the existing form recovery in `apps/mobile/src/data/expense-draft.ts` and `group-draft.ts`. Saves that weren't confirmed come first, with a warning.
- **The controller:** `apps/mobile/src/data/mobile-controller.ts`. Follow how it loads and caches Home balances (`homeBalancesKey`).
- **App links:**
  - `androidInvitationFilters` in `apps/mobile/src/config.ts` declares only `/join/` today, and `app.config.ts` uses it.
  - Incoming links are parsed in `apps/mobile/src/data/invitation-links.ts`.
- **The verifier:** `apps/mobile/scripts/verify-shared-drafts.ts` is the existing cross-client Draft verifier.
- **Flags:** `EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED` in the app, and `PERSISTENT_DRAFTS_ENABLED` on the backend.

## Decisions already made
Don't reopen these. Note any other decision you make under "Notes for review" in the PR.

1. **Flag off means Android exactly as today.** That includes Home's Continue rows; production has the flag off, and phone-only items must stay reachable there. Everything below applies only with the flag on.
2. **One read, one model.**
   - The Home card, the Group banner and the list all come from the cross-Group read through `buildToReview`, cached under `toReviewKey` like the other Home reads.
   - Phone-only items enter as `DeviceToReviewItem`s built from the existing form recovery. Don't change how or where they're stored: Finish later, upload and carry-over are #410.
   - A phone item whose save wasn't confirmed keeps its existing warning ("We didn't hear back, so it may already be saved"), and Continue opens the form as today, where that save is resolved first.
3. **What goes, with the flag on:**
   - the private Drafts button and modal;
   - Home's Continue rows (their items show in the card instead).
   - The Group's floating "Resume draft" **stays**; #410 removes it.
4. **Tapping a server item in the list** opens the existing Draft editing the old screen used, so needs-details items stay fixable before #409. #409 replaces this with the one-at-a-time card. Delete the old modal's code only once nothing uses it.
5. **"Review N, one at a time"** opens the first Group's list for now. #409 makes it a cross-Group run.
6. **Save N ready.**
   - Run the existing per-item review step for exactly the ready items in that Group. The confirmation sheet then shows those versions and their exact total, from the shared model's money, and "Balances there will change for everyone".
   - Confirm saves those reviewed versions through the shared client.
   - The results sheet shows each outcome: saved, failed (with its reason), or "We didn't hear back, so it may already be saved" with **Check again**.
   - Check again resends the original identity and can never save twice.
   - Items that changed between review and confirm come back as failed. Show them as "Changed since you checked"; don't save them.
7. **Offline.**
   - The card shows "You're offline. What Claude prepared and what you set aside show up when you're back online", and still lists phone-only items.
   - Nothing tries to load or save account items while offline.
   - Nothing uploads automatically on reconnect.
8. **App links.**
   - Add a separate intent filter for `/groups/<id>/review`, for example a `pathPattern` like `/groups/.*/review`. Never use a bare `/groups/` prefix, and leave the `/join/` filter unchanged.
   - The link opens that Group's To review list.
   - Signed out, it goes through the existing sign-in and then lands there.
   - For a Group you can't see, it shows the existing unavailable state.
   - Domain verification is per domain, so no server change is needed. This changes the native manifest, so say in the PR that it needs a new APK. Don't build one.
9. **Member words only.** Never show Draft, revision, request or collection.
   - Money is in exact minor units, formatted with the shared formatter.
   - Dates use the app's own helpers, never hard-coded.

## Tests
- **Render tests through the mobile controller,** in the existing `apps/mobile/src/ui/*.test.tsx` style. Cover:
  - the card: waiting, offline, all caught up/hidden, and with phone-only items;
  - the banner;
  - the list: every section and the empty state;
  - the Save N ready confirmation;
  - results with saved, failed, changed and unconfirmed outcomes, plus Check again;
  - an app link opening the list;
  - flag off showing today's Home with its Continue rows.
  - Run each at 130% text and in dark.
- **A lost-reply test:** the reply to a save is lost, Check again runs, and there is exactly one Expense.
- **Mobile HTTP verifier:** extend `verify-shared-drafts.ts` or add a `verify-to-review.ts`, wired the same way. It should cover the cross-Group read and Save N ready against a real backend, with fictional Groups and Drafts, including one prepared by a fictional "Claude".
- **Shared unit tests** for anything you add to `@splitbook/shared`.

## Checks
- **Backend:** run `pnpm swarm up` from the repository root. It starts your own backend on a free loopback port with a fresh `splitbook_mobile_*` database on Mongo 27018, and prints `MOBILE_VERIFY_URL`. Make sure the draft flag is on for it.
- **`pnpm swarm gate`** runs the ticket checks, including every verifier against your backend. Run it, and `pnpm swarm down` afterwards.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`.
- `pnpm test:unit --maxWorkers=2` in UTC and with `TZ=Pacific/Pago_Pago`. CI also runs Kiritimati and Tongatapu.
- **If the host's plain `pnpm` fails**, use `corepack pnpm`.
- **No emulator or device work.** emulator-5554 belongs to the owner, who does device acceptance separately.

## Resources and rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554. They belong to other sessions. #407's agent uses ports 3407 and 9407.
- Name scratch files `w408-*`.
- Fictional data only: the repo is public.
- Never delete branches. Never use bare `git stash`.
- **Clean up afterwards:**
  - `pnpm swarm down`;
  - stop anything else you started;
  - remove your scratch files.

## Commit and PR
- **Commits:** plain messages, with no model names and no Co-Authored-By trailer.
- **When every check passes,** push the branch and open a PR to `main` with the `full-ci` label.
- **The PR body:**
  - starts with "Closes #408. Part of #403.";
  - says what changed;
  - lists the commands you ran, with their results;
  - says the app links need a new APK;
  - has a "Notes for review" section for any decision you made;
  - ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **Editing the body later:** `gh pr edit` fails in this repo. Use `gh api -X PATCH repos/FireBird1998/splitbook/pulls/<n> -F body=@<file>` instead.
- **Don't merge.** The orchestrating session reviews and merges.

## Report back
- the PR link, the branch and the head SHA;
- the files changed, with reasons;
- what was removed and where its items now appear;
- every command, with its result;
- open questions.
