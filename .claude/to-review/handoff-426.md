Build GitHub issue #426 in FireBird1998/splitbook: "To review: count one-payer items without a Category as Ready". It is part of spec #425; the parent feature is #403.

Read #426 and #425 first, with `gh issue view <n> --repo FireBird1998/splitbook`. #426's acceptance criteria are your definition of done. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`.
- **Branch:** `git fetch origin && git switch -c fix/426-assistant-items-ready origin/main`. Main is 61f83de or later.
- **Another agent is building #427 at the same time.** It changes the assistant tools' descriptions and the Category field in the Draft input schema.
  - Leave `apps/web/src/lib/mcp/tools.ts` and `assistant-ledger.service.ts` to it.
  - You both add tests to `apps/web/src/lib/mcp/connection-test-suite.ts` and touch `packages/shared/src/validators/expense-draft.ts`. Keep your changes there small. If #427 merges first, rebase and keep both.

## What's wrong (found on staging, 2026-10-16)
Claude prepared Dinner and Taxi with **one payer and no amount for them**, and **no Category**. Every item showed "Needs … who paid, the category", so nothing an assistant prepares can be Ready.
- **The payer.** `completeExpenseDraftSchema` requires `paidBy[].amount`, so a lone payer without one fails as `paidBy.0.amount`. Add expense never asks for it: with one payer, they paid the whole Expense.
- **The web panel.** `ReviewExpenseFields` opens that item in the several-payers mode, because the payer's amount (missing) doesn't equal the total.
- **The Category.** `completeExpenseDraftSchema` deliberately removes the default (`removeDefault()`), and the server's `draftValidation` lists `category` as required. Add expense saves Other when none is chosen.

## Where things are
- **Shared:**
  - `packages/shared/src/validators/expense-draft.ts` has `completeExpenseDraftSchema`.
  - `packages/shared/src/to-review.ts` has `accountModel` for readiness and missing facts, and `buildToReview` for the ready selection and totals.
  - `packages/shared/src/persistent-draft-editor.ts` has `draftEntries` and `draftValues`.
- **Server:** `apps/web/src/lib/services/expense-draft.service.ts`, with `draftValidation`, `reviewValues` (allocation and problems) and the save path that parses `completeExpenseDraftSchema`.
- **The web panel:** `apps/web/src/components/to-review/ReviewExpenseFields.tsx`, covering `multiPayerMode` and the `category` value.
- **Android:** `apps/mobile/src/data/review-form.ts` (`reviewForm` maps `category` to `''`) and the Category chips in `apps/mobile/src/ui/expense-form.tsx`.

## Decisions already made (#425)
1. **One shared completion step** turns Draft values into Expense input. It applies exactly two rules:
   - a lone payer with no amount pays the whole Expense amount;
   - a missing Category becomes Other.
   - It never fills in anything else.
2. **Everything uses it:**
   - the shared model's readiness and missing facts;
   - the server's missing fields and problems;
   - the review allocation and the duplicate check;
   - the Save N ready selection and its totals;
   - saving.
   - Don't rewrite stored Draft values, so the review fingerprint stays the same.
3. **These rules stay:**
   - with two or more payers, each needs an amount;
   - a lone payer whose amount differs from the total is a problem, in member words;
   - no payer at all still needs "who paid" and keeps the "didn't know who paid" note;
   - an invalid Category is still refused.
4. **The panels.**
   - **Web:** a lone payer without an amount opens in the one-payer mode ("Paid by …"), and changing the amount keeps that payer paying all of it.
   - **Web and Android:** with no Category stored, the Category control shows Other. A change stores the member's choice.
5. This reverses #396's rule that review mustn't apply the default Category. Update the comment on `completeExpenseDraftSchema` to say why: Add expense saves Other, and Category never affects Balances.

## Tests
- **Shared unit tests** in all four CI time zones, covering the five cases in #426's first criterion.
- **The MCP connection suite: replay Claude's staging item.**
  - Create the item through `create_drafts` with one payer without an amount, no Category, an equal split, a Tag and a date.
  - The To review read shows no missing fields.
  - Saving it through the web Draft save gives an Expense with that payer paying the whole amount, Category Other, and `preparedBy` the assistant.
- **Playwright on the demo seed:**
  - an assistant-prepared one-payer item without a Category shows Ready;
  - the panel shows "Paid by …" and Other;
  - Save 1 ready saves it;
  - light and dark at 130% text, with axe.
  - Seed it with `playwright/to-review-seed.ts`. Add `splitbook_w426` to the demo-database lists in `to-review-seed.ts` and `finish-later.spec.ts`.
- **Android unit tests** in `review-form.test.ts` and `review-run.test.tsx`:
  - Other shows when no Category is stored;
  - a one-payer item without an amount counts as Ready.
  - No emulator or device work.

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm web check:design-system`.
- `pnpm test:unit --maxWorkers=2` in UTC and `TZ=Pacific/Pago_Pago`.
- **Integration** (including `connection.integration.test.ts`), with `PERSISTENT_DRAFTS_ENABLED=true`:
  - `TEST_MONGODB_URI` must point at your own single-node replica set with `--setParameter enableTestCommands=1`;
  - `STANDALONE_TEST_MONGODB_URI` must point at your own standalone;
  - call the containers `w426-*`, on free ports.
- **Expense-access suite:** `pnpm web test:expense-access` against your replica set with `EXPENSE_ACCESS_MONGO_PORT=<its port>` and the flags on. It must pass with no retries.
- **Demo browser suite:** port 3426, database `splitbook_w426`, `--workers=1`, a production build, both draft flags on. Run the To review, Finish later and your new journeys.
- **If plain `pnpm` fails**, use `corepack pnpm`.

## Rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554.
- Fictional data only. Never delete branches. Never use bare `git stash`.
- **Clean up** your containers and databases afterwards.
- **Commits:** plain, with no model names and no Co-Authored-By trailer.
- **The PR:** when the checks pass, push and open it to `main` with the `full-ci` label.
  - The body starts with "Closes #426. Part of #425." It lists the commands you ran with their results, and has a "Notes for review" section.
  - It ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **Editing the body later:** use `gh api -X PATCH repos/FireBird1998/splitbook/pulls/<n> -F body=@<file>`.
- **Don't merge.**

## Report back
- the PR link, the branch and the head SHA;
- the files changed, with reasons;
- every command, with its result;
- open questions.
