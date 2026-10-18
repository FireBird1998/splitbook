# Connected assistants

A Connected assistant acts as one member in Splitbook. It reads the ledger and, with separate permission, prepares Expense Drafts for the member's To review. Only the member saves Expenses in Splitbook.

**Updated 19 October 2026.** These docs replace the unmerged [4 October concept PR #242](https://github.com/FireBird1998/splitbook/pull/242). They distinguish the chosen product model from implementation at `5c700703`; they do not announce a release.

| Document                                            | Purpose                                                 |
| --------------------------------------------------- | ------------------------------------------------------- |
| [Concept](concept.md)                               | Scope, screens and production gates                     |
| [Access and safety](access-and-safety.md)           | Chosen Group access, permissions, disconnect and expiry |
| [Decisions](decisions.md)                           | What survives or supersedes the 4 October decisions     |
| [Tools and insights](tools-and-insights.md)         | Implemented tools versus historical proposals           |
| [Research and implementation evidence](research.md) | Source pointers and acceptance still needed             |

## Authority and related records

- [Spec #603](https://github.com/FireBird1998/splitbook/issues/603) records the owner's 19 October decisions Q16–Q24. Its published solution and implementation decisions are authoritative; its current body does not number each answer separately.
- [Spec #383](https://github.com/FireBird1998/splitbook/issues/383) governs persistent Expense Drafts, as amended by #603 for Group access and connection controls. Its [local spec](../specs/mcp-drafts-review/spec.md) is a historical record; subsequent decisions take precedence.
- [ADR 0005 update](../adr/0005-mcp-server-in-web-app.md#update-19-october-2026) records the architecture and Group access model. [ADR 0008 update](../adr/0008-persistent-assistant-expense-drafts.md#update-19-october-2026-group-access) amends its original all-Groups consent.
- [Glossary](../../GLOSSARY.md) defines Connected assistant, Excluded Group, Assistant rule, Draft and To review.
- [Original server spec](../specs/2026-10-01-mcp-server.md) and [backend design](../specs/2026-10-01-mcp-backend-design.md) remain historical proposals, not the current tool inventory or permission contract.
- [Connection runbook](../runbooks/mcp-connections.md), [connection QA](../qa/mcp-connection-384.md) and [staging results](../qa/mcp-staging-2026-10-11.md) describe implementation and dated verification. Their older all-Groups and DCR rollout wording is superseded by #603's chosen model, which is not yet fully implemented.
- [Design canvas](https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9), page “Connected assistants (MCP)”, is private to the owner. Current board names and superseded ideas are mapped in [Concept](concept.md#screens). Its private contents require owner review; no new design is supplied here.
