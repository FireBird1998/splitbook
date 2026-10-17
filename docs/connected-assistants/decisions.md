# Connected assistants: decisions

The owner made these decisions on 2026-10-04, after a design review of the concept screens and a question-by-question session. They amend the [product spec](../specs/2026-10-01-mcp-server.md), the [backend design](../specs/2026-10-01-mcp-backend-design.md) and [ADR 0005](../adr/0005-mcp-server-in-web-app.md).

## Scope

1. **The first version is read-only.** Recording, editing and deleting come later, one step at a time.
   - Turned down: recording Expenses and Settlements in the first version; everything the member can do in the app, including invitations and roles.
2. **Splitbook computes insights; the assistant explains them.** Exact figures come from one shared module.
   - Turned down: giving the assistant raw lists and letting it add up money, which risks miscounting and mixing currencies.
3. **The first version answers four insights:** spending summary, trends against previous Months, across my Groups, and Trip summary.

## Access

4. **An assistant reaches all the member's Groups except Excluded Groups.** All Groups start ticked on the approval page, and Groups joined later are included.
   - Turned down: no Groups ticked by default (briefly accepted earlier the same day, then replaced); all Groups with no exclusions.
5. **The assistant is never told about Excluded Groups.** Excluded Groups are simply absent, and the approval page and Settings warn the member that answers leave them out.
   - Turned down: telling the assistant how many Groups were left out.
6. **Each Group has an Assistant rule set by its admins:** Allowed or Not allowed, with Allowed as the default.
   - Turned down: Not allowed until an admin opts in.
7. **Admins see which members' assistants can reach their Group, and when each was last used.** Members only see the rule.
   - Turned down: everyone seeing who; nobody seeing who.
8. **No per-tool switches.** Access is the read scope plus the Group choice.
9. **No call log for members.** Members see "last used"; operational logs keep tool, member, Group and outcome only.
   - Turned down: a 30-day per-assistant log.
10. **Other members appear by name and id only.**
    - Turned down: including emails so an assistant could draft messages.

## Lifetime

11. **Disconnecting takes effect immediately.** Every call checks that the approval still exists.
    - Turned down: letting an issued access token run until it expires, up to an hour.
12. **A connection unused for 90 days expires.**
    - Turned down: staying connected until disconnected; expiring after 30 days.

## Clients and rollout

13. **Clients identify themselves only with Client ID Metadata Documents.** Dynamic client registration stays off.
    - Consequence: assistants without metadata-document support can't connect yet. Revisit if an important client needs registration.
    - Turned down: metadata documents and registration together; deciding after a client test.
14. **No assistant is targeted first.** Build to the MCP standard and test with the official MCP SDK.
    - Turned down: Claude first; ChatGPT first.
15. **Rollout:** staging for the owner and testers first, then private beta members who switch Connected assistants on in Settings (off by default).
    - Turned down: the whole private beta at once; owner only.

## Deferred and dropped ideas from the canvas

16. **Deferred:**
    - an approvals queue ("Waiting for you"), because it would need pending entries stored on the server;
    - Group amount limits;
    - a "Read only" value for the Assistant rule.
17. **Dropped:** per-tool switches, the member call log, and the "not used for 30 days" reminder (replaced by expiry).

## Language and docs

18. **"Paid" is the word for what a member put toward Expenses;** "fronted" is avoided. The web month table that says "fronted" is renamed when it is next touched.
19. **The docs live in this folder.** The two spec files stay where they are with amendments, ADR 0005 is revised, and the canvas holds screens and key notes that link here.

## Derived while writing these docs (confirm)

These follow from the decisions above but were not asked directly:

- **A Group whose Assistant rule is Not allowed looks to the assistant exactly like an Excluded Group.** It is absent from lists, and asking for it by id gets "Group not found". This keeps decision 5 consistent.
- **"Across my Groups" breaks your spending down by Group and by Category, not by Tag.** A Tag belongs to one Group, so Tags with the same name in different Groups are different Tags.
- **"Trends" compares a Month with the average of the Months before it.** The Month itself is not part of the average.
