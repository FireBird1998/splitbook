# Connected assistants: research notes

## How the protocol and sign-in fit Splitbook

The [backend design](../specs/2026-10-01-mcp-backend-design.md) has the full detail; this is the short version.

- **Where it runs.** The MCP server is a stateless route, `/api/mcp`, in the web app. It uses streamable HTTP, POST only, with no protocol sessions, which suits Vercel functions.
- **Sign-in.** Better Auth is the OAuth 2.1 authorization server through `@better-auth/mcp`, with its JWT and Client ID Metadata Document plugins. This needs Better Auth 1.7.7 or later; the app is on 1.7.3.
- **Discovery and tokens.** Discovery documents are public. An unauthenticated call to `/api/mcp` gets a 401 challenge that tells the client where to sign in. Tokens are audience-bound to `/api/mcp` and issued with PKCE.
- **One path for all clients.** Both the HTTP API and the MCP tools go through one actor-scoped ledger operations module. That module is the first delivery step, and it is useful even without MCP.

### What the 2026-10-04 decisions add to that design

These need checking against the plugin before building:

- **Approval checked on every call.** Each call must confirm that the member's approval (the OAuth consent) still exists, so disconnecting is immediate. Check whether the plugin exposes a cheap consent lookup, or whether Splitbook keeps its own record of connections.
- **Per-connection settings.** Each connection needs Excluded Groups and a "last used" time. They belong in Splitbook's own data, keyed by the consent, because the plugin's tables shouldn't carry product fields.
- **90-day idle expiry.** Implement it with "last used" plus refresh-token handling: refuse the refresh, or delete the consent, once the connection has been idle for 90 days.
- **Assistant rule.** It is a new Group setting, Allowed or Not allowed. The operations module checks it alongside membership.
- **Opt-in switch.** It is a member setting. The approval page has to explain what to do when the switch is off.

## What members can do in the app today

This is the starting point for deciding what later write tools may do. It was mapped from the web API on `main` as of 2026-10-04.

| Operation                                    | Who may                                                      | Reversible                                                     | Activity                   |
| -------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------- |
| Create Expense                               | any member                                                   | soft delete                                                    | yes                        |
| Edit Expense                                 | any member (no creator or role check)                        | edit history kept                                              | yes, with the changes      |
| Delete or restore Expense                    | any member                                                   | yes, soft delete and restore                                   | yes                        |
| Record Settlement                            | the payer or the recipient                                   | **no** (no edit or delete exists)                              | yes                        |
| Recurring bills: create, edit, pause, delete | admin, Household only                                        | pause yes; delete is permanent                                 | no (generated Expenses do) |
| Tags: add, rename, archive, delete           | admin                                                        | archive yes; delete has no restore                             | no                         |
| Group settings, currency, archive            | admin                                                        | currency locks once anything is recorded                       | yes                        |
| Promote, demote or remove members            | admin (last-admin guard)                                     | role yes; removal only by re-inviting                          | yes                        |
| Leave the Group                              | the member, once settled up; the last admin hands over first | rejoin by invite; the last member's leaving archives the Group | yes                        |
| Invite by email, invite link                 | any member                                                   | no cancel; a new link replaces the old one                     | no                         |

Expense edits and deletes need the Expense's current revision (`If-Match`). Creates use an `Idempotency-Key`. Both suit assistants, because a retried call can't double-record or overwrite a newer change.

## Found while mapping (outside this feature)

- Expense create, edit and delete don't check whether the Group is archived.
- Settlements can't be corrected or deleted once recorded.
- Email invitations can't be cancelled, and invite links can't be turned off, only replaced.

## Open research

- **Clients.** Which assistants publish Client ID Metadata Documents today, and which MCP protocol versions do they speak? This decides who can connect in the first version. Record what was verified, with dates.
- **Plugin fit.** Does `@better-auth/mcp` allow a consent check on every call and refresh refusal after 90 days idle, without patching it? And can its consent page be Splitbook's own page with the Groups list?
- **Insight performance.** "Across my Groups" and `compare_months` read many Expenses. Measure them on realistic data (Household Groups with 12 or more Months) before deciding whether any figures need caching.
- **Rate limits.** Pick sensible per-connection limits for read calls on Vercel.
