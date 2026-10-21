# Connect Claude on staging: verification, 22 October 2026

Scope: #619's acceptance criterion: "The Claude setup is checked on staging with real Claude (connect, connection check, a read, disconnect), and the result is recorded in the QA notes before release." Public route: `/connect`, Claude choice.

## Setup

- **Staging:** the `splitbook-staging` Vercel project, deployed from main `2350cc59` from a clean Git archive (deployment `dpl_FsykLpMZyRhH6D4Xk81eR7wsuVF4`). It's aliased to `staging.splitbook.in` and `mcp.staging.splitbook.in`. No environment variables, DNS or production changed.
- **Claude:** the owner's claude.ai account, with the existing custom connector "SplitBook Staging" at `https://mcp.staging.splitbook.in/api/mcp`. Claude used it through its tools: `connection_status` and `list_groups`.
- **Browser:** the owner's existing staging session. No credentials were entered.

## Result: pass

1. **Guide.** `/connect` offers Claude, ChatGPT, Claude Code and Other MCP client. The Claude setup shows the server address `https://mcp.staging.splitbook.in/api/mcp`, sign-in and approval steps, the test prompt and the authorization check. "What an assistant can do" reuses the approval page's "It can't" list.
2. **Disconnect from an existing grant.** Settings → Connected assistants → Disconnect Claude → confirm "Disconnect Claude?".
   - Claude's next call was refused, and claude.ai said the connector needs reconnecting.
   - ChatGPT's grant was untouched.
3. **Connect.** claude.ai → Connectors → SplitBook Staging → Connect opened Splitbook's approval page. It showed:
   - "Claude wants to use your Splitbook", identified by its published client metadata;
   - "Signed in as" the member, with "Not you?" (accessible name "Not you? Sign in with another account");
   - Read only by default, with To review access off;
   - every Group ticked under "Which Groups";
   - the "can't" list.

   Allow connection returned to claude.ai. Settings showed Claude as "Read only", the Groups as all included, and its last use.

4. **Connection check.** `connection_status` returned `connected: true`, `mode: connection-test`, with no ledger data.
5. **A read.** `list_groups` returned exactly the Groups ticked on the approval page, each with its currency and extra currencies, and no member emails.
6. **Disconnect.** Settings → Disconnect Claude → confirm.
   - Claude's next read was refused at once.
   - The guide's authorization check said "Claude is not authorized for this account."
7. **Left as found.** Claude was reconnected with the owner's earlier choice, "Read only + To review", with all Groups. `connection_status` confirmed it.

## Observations

- **A stale consent page grants nothing.** Reloading an interrupted approval dropped its signed request. The page said "This connection request is invalid, expired, or unavailable to your account. Restart from your assistant.", with Deny and Allow disabled. Restarting from claude.ai worked.
- **Staging database hiccups.** Two page loads during the run (`/settings`, then `/mcp/consent`) answered a server error after about 30 s. In Vercel's logs both were `MongoServerSelectionError: Server selection timed out after 30000 ms` (`ReplicaSetNoPrimary`) from the staging Atlas cluster. A reload succeeded. The ChatGPT walkthrough of 12 October saw the same kind of failure. It's infrastructure, not this feature; tracked in #826.

No credentials, OAuth parameters or ledger details are kept in this record.
