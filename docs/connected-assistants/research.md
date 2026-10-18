# Connected assistants: implementation evidence and remaining verification

Reviewed 19 October 2026 against `main` at `5c700703`. This is a documentation audit, not a new hosted acceptance run. The chosen model is [#603](https://github.com/FireBird1998/splitbook/issues/603); older verification reports remain dated evidence.

## Current implementation versus chosen model

| Area                 | Baseline evidence                                                                                                                                                        | Chosen change still required                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service and identity | Stateless `/api/mcp` in the web app; Better Auth OAuth, JWT and metadata-document support; [auth configuration](../../apps/web/src/lib/mcp/auth-plugin.ts)               | Keep Client ID Metadata Documents for rollout, DCR off; real-client acceptance remains required                                                             |
| Group access         | [`assistant-ledger.service.ts`](../../apps/web/src/lib/services/assistant-ledger.service.ts) filters membership/deletion; no per-connection exclusions or Assistant rule | #617 and #621: apply the same Group rule to every read and Draft tool; omit unreachable Groups and make id probes indistinguishable from nonexistent Groups |
| Permissions          | [`tools.ts`](../../apps/web/src/lib/mcp/tools.ts) gates Draft tools by separate scope and feature flag; no save tool                                                     | Preserve separate To review permission and member-only save                                                                                                 |
| Revocation           | [`grants.ts`](../../apps/web/src/lib/mcp/grants.ts) checks current account, consent, scopes and generation; disconnect rotates generation                                | Preserve immediate revocation when adding controls; requests authorized earlier may finish                                                                  |
| Consent              | [`OAuthFlow.tsx`](../../apps/web/src/components/mcp/OAuthFlow.tsx) shows raw client identity, all-Groups wording and optional preparation permission                     | #614: name, Group checklist, leave-out warning, complete “It can't” list                                                                                    |
| Settings             | [`ConnectionsSetting.tsx`](../../apps/web/src/components/mcp/ConnectionsSetting.tsx) renders raw client IDs/scopes and disconnects directly; API already resolves a name | #615/#620: name/access/reach/last-used list, per-assistant Groups, confirmed Disconnect                                                                     |
| Lifetime             | Connection record has created time/generation, no last-used/exclusion fields; access token lifetime is 300 seconds; provider refresh default is 30 days                  | #618: last-used updates at most once a minute on authorized calls, 90-day idle expiry, compatible token lifetimes, expired connections omitted              |
| Connect              | Existing [ChatGPT guide](../../apps/web/src/components/mcp/ConnectChatGPT.tsx)                                                                                           | #619: ChatGPT/Claude/Other picker and help; verify Claude guide on staging                                                                                  |
| Android              | Native Draft review/save exists; no Connected assistants Account screen                                                                                                  | #622: list, confirmed Disconnect and web banner; no native connecting or Group editing                                                                      |

These tickets remain subject to their own design release and explicit assignment. This audit does not implement or approve their designs.

## Historical claims replaced

The 4 October research said the protocol implementation was unbuilt, consent lookup feasibility was unresolved, the first release had no writes at all, and a per-member switch was needed. Main now implements OAuth/metadata support and live generation checks, plus private Draft mutations; #603 removes the member switch. Do not reuse the old API inventory, plugin-upgrade plan, archived-Group bug list or receipt backlog as a new implementation assignment.

Current `MCP_ALLOW_DCR` is false by default but remains available to compatibility tests. #603's metadata-only rollout is stricter than the older runbook's optional DCR fallback. No environment setting was inspected or changed in this audit. Likewise, code showing an enabled path does not prove production is enabled or acceptance has passed.

## Verification before production

Use the [runbook](../runbooks/mcp-connections.md), [staging report](../qa/mcp-staging-2026-10-11.md) and [connection QA](../qa/mcp-connection-384.md) as dated operational evidence. #603 requires real ChatGPT and Claude staging checks of connect, exclusion, Not allowed, Draft preparation, disconnect and reconnect; expiry is exercised with a shortened staging-only setting. The access-rule tests use the existing real HTTP/OAuth client boundary, including next-call changes, future membership, nondisclosure and retained Drafts.

Group settings must verify admin-only rule changes and reach-list access, plus Activity. Web checks cover consent, Connect and Settings. Android checks cover its shared connection API, confirmation and banner at 100%, 130% and 200% text, plus an emulator pass. These are future implementation acceptance requirements, not checks run for this docs-only change.

All production gates in [Concept](concept.md#production-gates) and the owner's QA review remain required. The private [canvas](https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9) link is retained from #242; board availability and visual approval require the owner/Designer. No new external protocol research or client-version claims are introduced here.
