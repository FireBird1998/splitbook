Build GitHub issue #404 in FireBird1998/splitbook: "To review 1: per-member limit, who prepared a Draft, and To review wording for assistants". It is the first ticket of spec #403 (To review). Every later To review ticket depends on it.

Read both issues first: `gh issue view 404 --repo FireBird1998/splitbook`, then the same for 403. #404's acceptance criteria are your definition of done, and #403's decisions are final. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR at the end.

Also read:
- `AGENTS.md`
- `CONTEXT.md`
- `docs/adr/0008-persistent-assistant-expense-drafts.md`
- `docs/specs/mcp-drafts-review/`

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`: it is on another branch with unsaved work.
- **Branch:** `git fetch origin && git switch -c feat/404-to-review-groundwork origin/main`. Main is 6974417 or later.
- **Scope:** server and shared code only. No changes under `apps/mobile`, and no UI.

## Where things are today (checked on 6974417)
- **`packages/shared/src/validators/expense-draft.ts`** holds:
  - `ACTIVE_DRAFTS_PER_GROUP = 100`;
  - `DRAFTS_PER_REQUEST = 10`;
  - `DRAFT_GROUP_LIMIT_MESSAGE`, which still has the old group-wide wording.
- **`apps/web/src/lib/services/expense-draft.service.ts`:**
  - `create` counts `{ group, state: 'active' }` across the whole Group inside the `mutate` transaction, then throws `DRAFT_GROUP_LIMIT`.
  - `list` already reads only the actor's own Drafts. Its comment about a group-wide population is now wrong.
  - `DraftActor` is `{ id, authorize? }` and is built on the server.
  - `present()` shapes every Draft read.
- **`apps/web/src/lib/draft-response.ts`** maps `DRAFT_GROUP_LIMIT` to 409.
- **`apps/web/src/lib/mcp/tools.ts`:** `registerSplitbookTools(server, actor, scopes, appUrl)` registers `list_drafts`, `create_drafts` and the other tools. It also maps the limit error.
- **`apps/web/src/app/api/mcp/route.ts`:**
  - The connection handler knows `userId`, `clientId` and `generation`, but passes only `{ id, authorize }` to the tools.
  - Client IDs are client-metadata URLs, for example ChatGPT's `https://chatgpt.com/oauth/client.json`.
- **`apps/mobile/src/data/mobile-controller.ts`** matches the code string `'DRAFT_GROUP_LIMIT'`.
- **Tests:**
  - `expense-draft.integration.test.ts`, next to the service;
  - `apps/web/src/lib/mcp/connection-test-suite.ts`, with `connection.integration.test.ts`.

## Decisions already made
Don't reopen these. Note any other decision you make under "Notes for review" in the PR.

1. **The limit is per member.**
   - Count `{ group, owner, state: 'active' }` inside the same transaction fence, and make sure an index covers that query.
   - You may rename the constant to say "per member" (for example `ACTIVE_DRAFTS_PER_MEMBER`); if you do, update every import.
2. **Keep the wire code `DRAFT_GROUP_LIMIT` and the 409 status.** Android and staging builds match on that code.
   - Change only the message, to exactly: "You have 100 items waiting in this Group. Save or delete some before keeping more."
   - Build the number from the constant.
3. **The shape.** Define one pure shared type and use it for both new fields on every Draft read: `preparedBy` and `changedBy`, each `{ kind: 'member' } | { kind: 'assistant'; name: string }`.
   - Store both on the record. Set `preparedBy` at creation. Set `changedBy` at creation and on every edit.
   - A record without these fields reads as `{ kind: 'member' }`. No migration.
   - Additive only: every field a Draft read returns today stays.
4. **Where the assistant's name comes from.**
   - Add the assistant to the actor the server builds, for example `DraftActor.assistant?: { name }`. Only the MCP route sets it, from the authenticated connection.
   - HTTP routes (the web and Android sessions) never set it, so they record `member`.
   - Use the same name the Connected assistants page shows for that connection, so the two always match. Find where that page gets it.
   - That name comes from client metadata that someone else controls. Trim it, strip control characters, collapse whitespace and cap it at 40 characters. If nothing usable is left, use "Assistant".
5. **The MCP creation result.**
   - Keep everything it returns today, and add `summary` and `reviewUrl`:
     - `summary` is "Added 3 to To review in Splitbook", or "Added 1 to To review in Splitbook" for one.
     - `reviewUrl` is `<appUrl>/groups/<groupId>/review`, built from the `appUrl` the tools already receive.
   - If today's result is a bare array, wrap it as `{ drafts, summary, reviewUrl }` in the MCP result only.
   - The HTTP create response doesn't change.
   - A replay returns the same summary and link.
6. **Tool descriptions.**
   - Say the Drafts land in the member's **To review** in Splitbook, where only the member can save them.
   - Say the limit is 100 per member per Group.
   - Don't use "private Drafts" or "collection".
   - Add a test proving that no registered tool saves a Draft as an Expense.
7. **Docs.**
   - **`CONTEXT.md`:** paste the two entries from #404 word for word, straight after **Draft collection**.
   - **ADR 0008** already reads the limit as per member and asks for that reading to be confirmed. Add one line saying #403 confirmed it.
   - **Other docs:** if `docs/specs/mcp-drafts-review/` or `docs/runbooks/mcp-connections.md` states a group-wide limit or the old message, fix it.

## Tests
Integration tests at the HTTP route and at the MCP tool boundary:
- **Per-member limit:**
  - When member A has 100 active Drafts, A can't create more, and nothing is written.
  - Member B in the same Group still can.
  - Discarded and saved Drafts don't count.
- **Over the limit:** a request that would pass 100 creates nothing. Over HTTP it returns 409 `DRAFT_GROUP_LIMIT` with the new text, and the MCP tool returns the same text.
- **Concurrency:** with 95 active, two concurrent requests of 5 leave exactly 100.
- **Who prepared and changed it:** reads return `preparedBy` and `changedBy`.
  - A web create reads `member`.
  - An MCP create reads `assistant`, with the connection's name.
  - An edit records who made it.
- **Forged names are ignored:** tool arguments that claim another name or `member`, at the top level or inside a Draft's values, don't change what's stored. Whether the schema strips or refuses extra keys, assert on what's stored.
- **Old records:** a record inserted without the fields reads as `member`.
- **Creation result:** the MCP result has `summary` and `reviewUrl`, for one Draft and for several.
- **Access is unchanged:** ledger-only connections still can't list or read Drafts, and revoked connections are still refused immediately.
- **Unit tests** for the pure shared pieces (the default reading and the name cleaner), if you put them in `@splitbook/shared`.

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`.
- `pnpm test:unit -- --maxWorkers=2` in UTC, then again with `TZ=Pacific/Pago_Pago`. CI also runs Kiritimati and Tongatapu.
- **Integration suites:**
  - Run them with `PERSISTENT_DRAFTS_ENABLED=true` on a MongoDB that supports transactions.
  - Use 27018 if it is a replica set. Otherwise start your own single-node replica-set container, `w404-mongo`, on a free port.
  - Use the database `splitbook_w404`.
- **No Playwright.** Nothing in the UI changes.

## Resources and rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554. They belong to other sessions.
- Name scratch files `w404-*`.
- Fictional data only: the repo is public.
- Never delete branches. Never use bare `git stash`.
- **Clean up afterwards:**
  - drop `splitbook_w404`;
  - stop and remove any container you started;
  - remove your scratch files.

## Commit and PR
- **Commits:** plain messages, with no model names and no Co-Authored-By trailer.
- **When every check passes,** push the branch and open a PR to `main` with the `full-ci` label.
- **The PR body:**
  - starts with "Closes #404. Part of #403.";
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
