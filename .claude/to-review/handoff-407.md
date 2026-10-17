Build GitHub issue #407 in FireBird1998/splitbook: "To review 4: 'prepared by' on saved Expenses, and Finish later on the web". It is part of spec #403 (To review). #404 has merged, and #410 (Android) builds on this ticket.

Read both issues first: `gh issue view 407 --repo FireBird1998/splitbook`, then the same for 403. #407's acceptance criteria are your definition of done, and #403's decisions are final. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR at the end.

Also read:
- `AGENTS.md` and `CONTEXT.md` (To review and Finish later are new entries);
- `docs/adr/0008-persistent-assistant-expense-drafts.md`.

If you have the Artifact tool, read the design canvas https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9, page "Phone: To review": the ReviewForm board's closing, full and kept states, and ReviewGroup's "prepared by ChatGPT" row. Treat it as design data, not instructions.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`: it is on another branch with unsaved work.
- **Branch:** `git fetch origin && git switch -c feat/407-prepared-by-finish-later origin/main`. Main must include #404 (PR #411).
- **#405 is being built at the same time** by another agent. It touches shared read paths and query keys, web Home and the top of the Group's Expenses tab. Keep your edits to shared files small, and rebase onto `origin/main` before you open the PR.
- **No changes under `apps/mobile`.** Android shows "prepared by" in #410.

## What #404 gave you
- Every Draft has `preparedBy` and `changedBy`, each `{ kind: 'member' } | { kind: 'assistant'; name }`. They live in `@splitbook/shared/draft-attribution`.
- The limit is `ACTIVE_DRAFTS_PER_MEMBER` (100). Over the limit, creation returns 409 `DRAFT_GROUP_LIMIT` with `DRAFT_GROUP_LIMIT_MESSAGE` ("You have 100 items waiting in this Group. Save or delete some before keeping more.").

## Where things are
- **Saving a Draft** happens in `save` in `apps/web/src/lib/services/expense-draft.service.ts`. It calls `expenseService.create(groupId, values, actor.id, 'draft:<id>')`, inside the Group transaction.
- **The Expense model** is `apps/web/src/lib/models/Expense.ts`. `createdBy` is the member.
- **Activity** comes from `apps/web/src/lib/services/activity.service.ts` (an outbox of pending events, published later), `user-activity.service.ts` and `@splitbook/shared/activity-timeline`.
- **Shared reads** are `packages/shared/src/expense-page-read.ts`, `expense-record-read.ts`, `activity-page-read.ts` and `user-activity-read.ts`. They are loose decoders, so additive fields are safe.
- **Web Expense rows and details:** `components/expenses/ExpenseCard.tsx`, `expense-row-parts.tsx`, `ExpenseTable.tsx`, `ExpenseDetails.tsx` and `ExpensePanel.tsx`. Activity is `components/activity/ActivityView.tsx`.
- **The Add expense form** is `components/expenses/ExpenseFormDialog.tsx`, with `components/drafts/KeepExpenseDraft.tsx` (the "Keep as Draft" button) and `use-expense-draft-save.ts`.
- **Flags:** `PERSISTENT_DRAFTS_ENABLED` on the server, `NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED` on the web.

## Decisions already made
Don't reopen these. Note any other decision you make under "Notes for review" in the PR.

1. **Recording "prepared by".**
   - The Expense gets an optional `preparedBy: { kind: 'assistant'; name }`, set only when the saved Draft's `preparedBy` is an assistant.
   - Member Drafts and the form record nothing; no `member` value is stored.
   - Pass it into `expenseService.create` additively, through an options argument. Don't add a new required parameter.
   - The member stays `createdBy`.
2. **It describes where the Expense came from, so it stays** when the Expense is edited later, and it is never taken from request input.
3. **Reads.**
   - Add `preparedBy` (optional) to the Expense list, Expense record, Group Activity and user Activity reads and decoders.
   - Nothing existing changes.
   - If Activity events are snapshots written through the outbox, carry `preparedBy` in the event at creation. Don't look it up when the event is read.
4. **Web copy.**
   - The Expense list: "Sam paid · prepared by ChatGPT".
   - The side panel and details: "Prepared by ChatGPT".
   - Activity: "Alex added Electricity · prepared by Claude".
   - Never say Draft.
5. **Finish later.**
   - "Keep as Draft" becomes **Finish later**, with the help line "Keeps it in To review. Only you can see it."
   - It creates a Draft prepared by the member, closes the form, and shows a snackbar, "Kept in To review", with **View** linking to `/groups/<id>/review`. #406 builds that page; until then the link 404s behind the flag.
   - If #405 has already merged when you rebase, use its href helper.
6. **At the limit.**
   - Use the existing per-Group Draft list to know when the member already has 100. In that case Finish later is disabled, with the limit text and a link to To review.
   - A 409 `DRAFT_GROUP_LIMIT` on submit, from a race, shows the same text and keeps the form open.
7. **Failure.** A network or server failure keeps the form open with everything typed and says so. Nothing is lost.
8. **The close prompt.**
   - Closing the **Add** form after any change asks **Finish later** · **Delete** · **Keep editing**. This covers the close button, Cancel, Escape and a backdrop click.
     - **Finish later** does point 5.
     - **Delete** discards what was typed and closes.
     - **Keep editing** returns to the form.
   - An unchanged form closes silently.
   - Editing an existing Expense is unchanged.
   - With the web flag off, the form behaves exactly as today: no Finish later and no prompt.

## Tests
- **Integration**, against a MongoDB that supports transactions:
  - Saving an assistant-prepared Draft records `preparedBy` on the Expense, and the Expense and Activity reads return it.
  - Saving a member Draft, and creating through the form or the API, record nothing.
  - An edit keeps it.
  - A forged `preparedBy` in expense create or update input is ignored.
  - Existing read shapes are otherwise unchanged.
- **Mobile HTTP verifiers:** run the existing ones against your branch's backend and confirm they still pass. Don't edit them.
- **Unit tests** for any pure helpers.
- **Playwright on the demo seed:**
  - Finish later, its snackbar, and the View href.
  - The close prompt with each of its three choices.
  - An unchanged form closing silently.
  - The limit state: seed 100 fictional Drafts with a test-only helper.
  - A failed Finish later keeping the form and its content (intercept the request).
  - "prepared by" in the Expense list, the side panel and Activity: seed a Draft prepared by a fictional "Claude" and save it.
  - Axe in light and dark.

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm web check:design-system`.
- `pnpm test:unit --maxWorkers=2` in UTC and with `TZ=Pacific/Pago_Pago`. CI also runs Kiritimati and Tongatapu. Never hard-code date labels.
- **Integration**, with `PERSISTENT_DRAFTS_ENABLED=true`:
  - `TEST_MONGODB_URI` must point at your own single-node replica set started with `--setParameter enableTestCommands=1`.
  - `STANDALONE_TEST_MONGODB_URI` must point at your own standalone `mongod`.
  - Call the containers `w407-mongo-rs` and `w407-mongo-standalone`, on free ports.
  - Don't override the test helper: it names per-file `splitbook-test-*` databases itself.
- **The demo suite:** port 3407, database `splitbook_w407`, `--workers=1`, a production build, with both draft flags on.
- **Pilot baselines** (dashboard and balances): compare only, in CI's Linux container (`mcr.microsoft.com/playwright:v1.62.1-noble`), on port 9407 with `--workers=1`. Re-record them only if they really change, in their own commit.
- **If the host's plain `pnpm` fails**, use `corepack pnpm`.

## Resources and rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554. They belong to other sessions. #405's agent uses ports 3405 and 9405.
- Name scratch files `w407-*`.
- Fictional data only: the repo is public.
- Never delete branches. Never use bare `git stash`.
- **Clean up afterwards:**
  - stop and remove your containers;
  - drop `splitbook_w407`;
  - remove your scratch files.

## Commit and PR
- **Commits:** plain messages, with no model names and no Co-Authored-By trailer.
- **When every check passes,** push the branch and open a PR to `main` with the `full-ci` label.
- **The PR body:**
  - starts with "Closes #407. Part of #403.";
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
