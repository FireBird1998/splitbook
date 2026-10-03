# Connected assistants: access and safety

A Connected assistant acts as exactly one member. It can never see or do more than that member can in the app, and usually less.

## Which Groups an assistant can reach

**Reachable Groups = the member's current Groups − their Excluded Groups − Groups whose Assistant rule is Not allowed.**

Every tool call checks this again: membership, exclusions and the Assistant rule. So leaving a Group, excluding it or an admin switching the rule to Not allowed takes effect on the assistant's next call.

### Excluded Groups (the member's choice)

- On the approval page every Group the member belongs to starts **ticked**. Unticking one makes it an **Excluded Group** for that assistant.
- Groups the member joins later are **included** automatically.
- Exclusions can be changed at any time in Settings › Connected assistants, separately for each assistant.
- **The assistant is never told that Excluded Groups exist.** They don't appear in lists, they aren't counted in "overall" answers, and asking for one by id gets the same "Group not found" result as an id that doesn't exist. The approval page and Settings tell the member that answers leave Excluded Groups out.

### Assistant rule (each Group's admins)

- Each Group has an **Assistant rule**: **Allowed** or **Not allowed**. It is **Allowed** by default, for existing and new Groups.
- **Not allowed** puts the Group out of reach for every member's assistant, whatever each member granted. The assistant sees it the same way as an Excluded Group.
- **What people see:**
  - Every member sees the Group's rule.
  - **Admins also see** which members have an assistant that can reach the Group, and when each was last used.
  - Members don't see each other's assistants.
- Later, when recording exists, the rule may gain a "Read only" value. It may also gain an amount limit. Neither is decided.

## Connecting

1. **Turn on Connected assistants.** During the private beta, a member first switches Connected assistants on in Settings. It's off by default. Until then, the approval page explains how to turn it on.
2. **The assistant identifies itself** with a **Client ID Metadata Document**, the URL it publishes about itself, such as `claude.ai`. The approval page names it from that document. Dynamic client registration is off, so assistants that support only that can't connect in the first version.
3. **Sign in.** The member signs in with the same Google account. The invite-only allowlist applies unchanged.
4. **Approve on Splitbook's page.** The approval page lists:
   - what the assistant can do: read your Groups, balances, Expenses, payments, recent changes and insights;
   - what it can't do: record, edit or delete anything, invite people or change a Group;
   - the Groups list, all ticked;
   - a note that answers leave Excluded Groups out.

   Allow or Deny. Deny shares nothing.

The grant is the `ledger:read` scope plus `offline_access`, so the assistant can stay connected without the member signing in again.

## Staying connected, disconnecting and expiry

- Access tokens are short-lived, at most an hour, and renew while the connection exists.
- **Disconnecting takes effect immediately.** Every call checks that the member's approval still exists, alongside the membership check. A disconnected assistant's next call fails, even with an access token that hasn't expired yet. This revises the original design, where an issued token stayed valid until it expired.
- **A connection that nobody uses for 90 days expires.** The assistant has to ask for approval again. Settings shows when each connection was last used and when it will expire.
- Settings lists each connection with its Excluded Groups, when it was connected and when it was last used. There is no per-call log for members.

## What the assistant receives

- Only what the member can already see in the app, minus Excluded Groups and Groups that are Not allowed.
- Other members appear by **name and Splitbook id only**, never their email or account details.
- Money is exact and kept per currency (see [Tools and insights](tools-and-insights.md)).
- Text written by Group members comes back in labelled data fields, and each tool description says it is data, not instructions.

## Logging

- Splitbook keeps operational logs of each call: tool, member, Group and outcome. Logs never include what was asked or what was answered.
- Members see only "last used" for each assistant, and admins see "last used" for the assistants that can reach their Group.

## Threats and controls

| Threat                                                | Control                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reading a Group the member isn't in                   | Every call goes through the actor-scoped ledger operations module and checks membership                          |
| Probing for Excluded or Not-allowed Groups            | One "Group not found" result for every unreachable Group; lists omit them                                        |
| Access after disconnecting, leaving or a rule change  | Approval, membership, exclusions and the Assistant rule are checked on every call                                |
| Forgotten connections                                 | Expiry after 90 days unused; "last used" in Settings                                                             |
| Prompt injection through descriptions, notes or names | The first version has no write tools; member text is fenced in named data fields; no tool acts on member text    |
| Personal data leaving Splitbook                       | Names and ids only; no emails or account details                                                                 |
| An unknown or impersonating client                    | Client ID Metadata Documents only; the approval page shows the client's own URL; audience-bound tokens with PKCE |
| Sensitive data in logs                                | Tool, member, Group and outcome only                                                                             |
