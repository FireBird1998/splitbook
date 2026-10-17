Build GitHub issue #419 in FireBird1998/splitbook: "To review fix 1: let Connected assistants prepare items (connect challenge and permission screen)". It is part of spec #418, the To review staging fixes; the parent feature is #403.

Read #419 and #418 first, with `gh issue view <n> --repo FireBird1998/splitbook`. #419's acceptance criteria are your definition of done. You may read GitHub. The only GitHub writes allowed are pushing your branch and opening the PR.

## Setup
- **Work in your own worktree.** Never use the main checkout at `/Users/ankitdas/AnkitPersonalProjech/SplidBook`: it has another branch with unsaved work.
- **Branch:** `git fetch origin && git switch -c fix/419-assistant-draft-permission origin/main`. Main is 272486f or later.
- **Another agent is building #420 at the same time** (the web review panel). Stay out of `apps/web/src/components/to-review/`.

## What's wrong (found on staging, 2026-10-15)
- An anonymous POST to the MCP endpoint answers 401 with `WWW-Authenticate: Bearer resource_metadata="…", scope="ledger:read"`.
- Claude and ChatGPT ask for exactly the scopes named there, so the permission screen never offers the Draft permission, and the Draft tools are never registered.
- Both live staging connections hold only `ledger:read` and `offline_access`.
- **Cause:** `apps/web/src/lib/mcp/connection.ts` calls `requireMcpAuth(…, { resource, requiredScopes: [MCP_LEDGER_SCOPE] })`, and the library advertises its challenge scopes from `challengeScopes ?? requiredScopes`.
- **Why nobody noticed:** the tests in `apps/web/src/lib/mcp/connection-test-suite.ts` build the authorize request with the Draft scope themselves (see `authorizeCode`), instead of following the challenge.

## Decisions already made
1. **The challenge.** Pass `challengeScopes`:
   - `[MCP_LEDGER_SCOPE, MCP_DRAFT_SCOPE]` when `PERSISTENT_DRAFTS_ENABLED === 'true'`;
   - otherwise `[MCP_LEDGER_SCOPE]`.
   - `requiredScopes` stays `[MCP_LEDGER_SCOPE]`.
   - Both constants are in `apps/web/src/lib/mcp/config.ts`.
   - Don't hand-write `WWW-Authenticate` headers.
2. **The permission screen.** In `apps/web/src/components/mcp/OAuthFlow.tsx` (the `/mcp/consent` page), keep the Draft checkbox **unticked** by default. Change the wording to exactly:
   - **Checkbox:** "Also let it prepare expenses for your To review".
   - **Help line:** "It can add, change and delete items in your To review. Only you can save them as expenses, in Splitbook."
   - **Notice:** "Prepared items don't change Balances until you save them."
   - **Footer:** "Disconnect at any time in Settings. Your To review items stay yours; disconnecting cannot erase information already shared with the assistant."
   - No "Draft" anywhere a member can see.
3. **The runbook.** Add one line to `docs/runbooks/mcp-connections.md`: to add the permission to an existing connection, disconnect and reconnect, then tick it.

## Tests
- **The new challenge-driven test** goes in the connection test suite:
  - read the 401 challenge;
  - parse its `scope`;
  - start authorization asking only for those scopes;
  - assert the consent details offer the Draft scope;
  - consent with and without it, and assert the tool list includes the Draft tools only when it was ticked.
  - With the flag off, the challenge and tools stay ledger-only.
  - Keep the existing tests unchanged.
- **A browser check of the permission-screen wording,** unticked by default, in light and dark at 130% text, with axe. There's no consent Playwright journey yet; add one by driving the real authorize flow on the demo seed, or explain your choice under "Notes for review".

## Checks
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`.
- `pnpm test:unit --maxWorkers=2` in UTC and `TZ=Pacific/Pago_Pago`.
- **Integration**, with `PERSISTENT_DRAFTS_ENABLED=true`:
  - `TEST_MONGODB_URI` must point at your own single-node replica set started with `--setParameter enableTestCommands=1`;
  - `STANDALONE_TEST_MONGODB_URI` must point at your own standalone;
  - call the containers `w419-*`, on free ports.
- **Demo browser suite:** port 3419, database `splitbook_w419`, `--workers=1`, a production build, both draft flags on.
- **If plain `pnpm` fails**, use `corepack pnpm`.

## Rules
- Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554.
- Fictional data only. Never delete branches. Never use bare `git stash`.
- **Clean up** your containers and databases afterwards.
- **Commits:** plain, with no model names and no Co-Authored-By trailer.
- **The PR:** when the checks pass, push and open it to `main` with the `full-ci` label.
  - The body starts with "Closes #419. Part of #418." and has a "Notes for review" section.
  - It ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **Editing the body later:** use `gh api -X PATCH repos/FireBird1998/splitbook/pulls/<n> -F body=@<file>`.
- **Don't merge.**
