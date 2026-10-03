# Connected assistants: concept

## Why

Members keep asking the same questions of their ledger:

- "Who still owes me for Goa?"
- "What did Maple House spend on Utilities this month?"
- "Did we spend more on groceries than usual?"
- "What do I owe overall?"

Today each answer means opening the app, finding the Group and reading screens. Many members already work inside an AI assistant. If that assistant can read their Splitbook, it can answer these questions in one sentence.

An assistant is only useful here if its numbers match the app exactly. Splitbook keeps money in exact minor units, keeps every currency separate and never converts. So the assistant should not add up money itself: Splitbook computes the figures and the assistant explains them.

## What the first version does

The first version is **read-only**. A Connected assistant can:

- **See your Groups,** their members, Tags, currency and Theme.
- **See balances:** yours across Groups, and a Group's suggested payments. Each currency is kept separate.
- **Search a Group's Expenses** by date, Month, Tag, Category, text, who paid and who shared. It can open any one Expense to see who owes what.
- **See a Group's Settlements and recent Activity.**
- **Ask Splitbook for insights.** Each one is exact and kept per currency (details in [Tools and insights](tools-and-insights.md)):
  - **Spending summary:** Spent, your Share and what you Paid for a Group and a period. It can break the figures down by Month, Tag, Category or person.
  - **Trends:** a Month against the Months before it, overall and by Tag.
  - **Across my Groups:** your Share, what you Paid and your balances across every Group the assistant can reach.
  - **Trip summary:** spend per day, per person per day, the biggest Expenses, and who should pay whom.

It can't record, edit or delete anything, and it can't invite people or change a Group.

## How members stay in control

The full rules are in [Access and safety](access-and-safety.md).

- **You connect** by signing in with the same Google account. You approve the access on a Splitbook page.
- **The assistant reaches every Group you belong to, except the ones you exclude.** Groups you join later are included, and you can change your exclusions in Settings at any time. The assistant is never told that Excluded Groups exist, so its "overall" answers leave them out. The approval page and Settings say so.
- **Each Group's admins set its Assistant rule:** Allowed (the default) or Not allowed. A Group that is Not allowed is out of reach for every member's assistant. Admins can see which members have an assistant connected and when it was last used.
- **Disconnecting takes effect immediately.** A connection that nobody uses for 90 days expires.
- **The assistant gets other members' names only,** never their emails or account details.

## What comes later

These are candidates, in a likely order. None is decided.

1. **Record an Expense or a Settlement.** The assistant shows a preview first and records exactly what you confirmed. Retrying never records it twice. The Expense then shows "via {assistant}" in Activity. The [spec](../specs/2026-10-01-mcp-server.md) already designs this as phase 2.
2. **Edit and delete Expenses.** Any member can do this in the app today. Deletes are soft, so they can be restored.
3. **Admin work**, such as Tags and recurring bills. In the app these are admin-only.

Not planned: anything that mainly affects other people, such as invitations, roles, removing members or archiving a Group.

Ideas explored on the canvas and **deferred**:

- an approvals queue ("Waiting for you") for entries an assistant prepared;
- Group amount limits for assistant entries.

Ideas **dropped**:

- per-tool switches;
- a per-assistant call log for members (they see "last used" instead);
- a "not used for 30 days" reminder (replaced by the 90-day expiry).

## Rollout

1. **Staging only,** for the owner and testers, behind the deployment flag.
2. **Private beta, opt-in.** Members switch Connected assistants on in Settings; it's off by default.
3. **Production** is a separate decision after staging verification.

Any assistant that identifies itself with a Client ID Metadata Document can connect. Assistants that only support dynamic client registration can't connect in the first version. Acceptance tests use the official MCP SDK.

## Screens

The [design canvas](https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9) (page "Connected assistants (MCP)") has clickable screens. Their status against these decisions:

| Board                           | Status                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How it works                    | First version, except the write branch (later) and the per-Group "Read and record" wording                                                              |
| Connect an assistant            | First version; the "record after you confirm" line is later                                                                                             |
| Approve access                  | First version for Groups and read access; "Read and record" is later; the Groups list should start all ticked                                           |
| In the assistant                | Questions and the refusal are first version; adding an Expense is later. A refusal for a not-allowed or excluded Group must say it can't find the Group |
| Settings · Connected assistants | First version, plus an opt-in switch; "Waiting for you" and the 30-day reminder are dropped or later                                                    |
| One assistant                   | Access, Groups and disconnect are first version; tool switches and the call log are dropped                                                             |
| What assistants can use         | First version for read tools; insight tools to be added; record tools are later                                                                         |
| Waiting for you                 | Later (deferred)                                                                                                                                        |
| Group rule                      | First version is Allowed or Not allowed plus who's connected; "Read only" and amount limits are later                                                   |
| Android screens                 | Connected assistants list: first version; "via Claude" in Activity: later (only recorded entries carry it)                                              |
