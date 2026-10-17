Build GitHub issue #427 in FireBird1998/splitbook: "Assistant tools: list the Category choices and talk about To review". It is part of spec #425; the parent feature is #403.

Read #427 and #425 first, with `gh issue view <n> --repo FireBird1998/splitbook`. #427's acceptance criteria are your definition of done. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`.
- **Branch:** `git fetch origin && git switch -c fix/427-assistant-category-choices origin/main`. Main is 61f83de or later.
- **Another agent is building #426 at the same time.** It changes readiness in the shared To review model, the server's Draft validation and save, and the review panels.
  - Stay out of `packages/shared/src/to-review.ts`, `expense-draft.service.ts`, `components/to-review/` and `apps/mobile/`.
  - You both touch `packages/shared/src/validators/expense-draft.ts` and add tests to `apps/web/src/lib/mcp/connection-test-suite.ts`. Keep your changes there small. If #426 merges first, rebase and keep both.

## What's wrong (found on staging, 2026-10-16)
- **Claude couldn't choose a Category:**
  - the Draft input's `category` is a free string refined against `CATEGORY_IDS`, so the tool's JSON schema shows no choices;
  - `group_context` returns members, Tags and currency only.
- **Claude said it would add the items "as drafts"** because of the tool name. Its reply afterwards correctly said To review.

## Where things are
- **The tools:** `apps/web/src/lib/mcp/tools.ts`, covering `group_context`, `create_drafts`, `replace_draft`, `list_drafts` and `discard_draft`, plus their descriptions.
- **The Group context:** `assistantLedgerService.context` in `apps/web/src/lib/services/assistant-ledger.service.ts`.
- **The Draft input schema:** `expenseDraftValuesSchema` in `packages/shared/src/validators/expense-draft.ts`.
- **The Category list:** `EXPENSE_CATEGORIES` in `packages/shared/src/categories.ts`.
- **Tests:** `apps/web/src/lib/mcp/connection-test-suite.ts`, run by `connection.integration.test.ts`. It uses real OAuth and the official MCP SDK.

## Decisions already made (#425)
1. **Category choices in the tools.**
   - The item tools (`create_drafts` and `replace_draft`) take Category as the fixed set of Expense Category ids, with each label visible to the assistant, for example in the schema's description.
   - An unknown Category is still refused.
   - Accepted values must stay identical to `CATEGORY_IDS`, so web and Android Drafts keep validating.
2. **The Group context** additively returns the Category choices, with id and label, alongside members, Tags and currency.
3. **Guidance in the tool descriptions:**
   - "For one payer, give who paid; they paid the whole amount. For several payers, give each amount."
   - "Choose a Category only when the member's words make it clear; otherwise omit it, and it's saved as Other."
   - Keep the existing rule: never invent payers, dates, participants or amounts.
4. **Words.**
   - The descriptions call them "items in the member's To review" and ask assistants not to call them drafts.
   - **Don't rename the tools.** Existing connections and the ChatGPT setup rely on the names.
5. **Read-only connections are unchanged.** The item tools stay hidden without `drafts:write`, and `group_context` keeps working with `ledger:read`.

## Tests
- **In the MCP connection suite:**
  - the listed `create_drafts` and `replace_draft` input schemas show the Category choices and their labels;
  - `group_context` returns the Category choices;
  - creating an item with a valid Category stores it;
  - an unknown Category is refused with a clear message;
  - the descriptions include the one-payer and Category guidance and the To review wording.
- **The existing connection tests pass,** including the challenge-driven one from #419 and the ledger-only checks.
- **The MCP runbook:** if `docs/runbooks/mcp-connections.md` lists what assistants can do, add one line saying they can choose a Category when it's clear. Otherwise leave it.

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`.
- `pnpm test:unit --maxWorkers=2` in UTC and `TZ=Pacific/Pago_Pago`.
- **Integration** (including `connection.integration.test.ts`), with `PERSISTENT_DRAFTS_ENABLED=true`:
  - `TEST_MONGODB_URI` must point at your own single-node replica set with `--setParameter enableTestCommands=1`;
  - `STANDALONE_TEST_MONGODB_URI` must point at your own standalone;
  - call the containers `w427-*`, on free ports.
- **No browser suite is needed** unless you touch web UI, which you shouldn't.
- **If plain `pnpm` fails**, use `corepack pnpm`.

## Rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554.
- Fictional data only. Never delete branches. Never use bare `git stash`.
- **Clean up** your containers and databases afterwards.
- **Commits:** plain, with no model names and no Co-Authored-By trailer.
- **The PR:** when the checks pass, push and open it to `main` with the `full-ci` label.
  - The body starts with "Closes #427. Part of #425." It lists the commands you ran with their results, and has a "Notes for review" section.
  - It ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **Editing the body later:** use `gh api -X PATCH repos/FireBird1998/splitbook/pulls/<n> -F body=@<file>`.
- **Don't merge.**

## Report back
- the PR link, the branch and the head SHA;
- the files changed, with reasons;
- every command, with its result;
- open questions.
