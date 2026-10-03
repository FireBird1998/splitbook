# Connected assistants

A **Connected assistant** is an AI assistant, such as Claude, ChatGPT, Claude Code or any other MCP client, that a member has allowed to read their Splitbook as them. Splitbook exposes itself to these assistants as a remote Model Context Protocol (MCP) server inside the web app.

**Status, 2026-10-04:** designed, not built, and not ticketed. The first version is read-only.

## In this folder

| Doc                                         | What it covers                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Concept](concept.md)                       | What it is and who it's for, what the first version does, what comes later, rollout and the screens |
| [Tools and insights](tools-and-insights.md) | Every tool the first version exposes, including the insights Splitbook computes                     |
| [Access and safety](access-and-safety.md)   | Which Groups an assistant can reach, consent, disconnecting, expiry, data shared, prompt injection  |
| [Decisions](decisions.md)                   | The decision log, with the options turned down                                                      |
| [Research](research.md)                     | Protocol and auth notes, what members can do today, and open research                               |

## Elsewhere

- **Decision record:** [ADR 0005](../adr/0005-mcp-server-in-web-app.md), revised 2026-10-04.
- **Product spec:** [Splitbook MCP server](../specs/2026-10-01-mcp-server.md), with the 2026-10-04 amendments at the top.
- **Backend design:** [MCP backend design](../specs/2026-10-01-mcp-backend-design.md), with the 2026-10-04 amendments at the top.
- **Glossary:** [CONTEXT.md](../../CONTEXT.md) defines Connected assistant, Excluded Group, Assistant rule and Paid.
- **Screens:** the [design canvas](https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9), page "Connected assistants (MCP)". It is private to the owner. Boards for ideas that were deferred or dropped are marked on the canvas.
- **Other product notes:** [Receipt reading (backlog)](../research/receipt-reading-backlog.md).
