# MCP and persistent expense Draft readiness

Status: assembled scope awaiting final interview confirmation, 11 October 2026. This brief records the agreed product choices and proposed implementation gates. It does not authorize implementation, deployment or public submission by itself.

SplitBook will expose an MCP endpoint inside its existing Next.js backend so ChatGPT and Claude can answer ledger questions and prepare multiple persistent Expense Drafts. Members review and save Drafts in either the web app or native Android. Both review clients are required at launch. The domain decision is [ADR 0008](../adr/0008-persistent-assistant-expense-drafts.md); older October 1 design documents remain unchanged and must not override its settled choices.

## Agreed experience

Each member has one private Draft collection per Group. Manual entry and authorized Connected assistants can add unfinished expenses to it. Missing fields remain explicitly unresolved. Drafts do not affect Balances and do not expire automatically.

Members can select Drafts to save. Each complete and valid Draft succeeds independently; failures remain available for correction. Possible duplicates require explicit acknowledgment. Stale edits and stale save requests must not overwrite or record a newer version. Retries cannot create duplicate Drafts or Expenses.

Connections cover all current and future Groups the member belongs to. Ledger access and private Draft access are separate permissions. Draft access permits reading, creating, revising and permanently discarding the member's Drafts, including manually prepared Drafts. Saving as an Expense remains in SplitBook. Revocation blocks further connection requests and preserves prepared Drafts.

The shared collection is online only. Android's existing local recovery remains available without automatic upload or automatic merging on reconnect. Membership loss blocks server access; retained Drafts require fresh review after rejoining. Group or account deletion removes the associated Drafts.

Hard limits are 10 Drafts per creation request and 100 active Drafts per member per Group. The per-member interpretation of the second limit is included in final scope confirmation. Discard is permanent with no recovery feature.

## What exists and what must be built

Inspection during this interview found a temporary web form Draft, one device-local Android Expense draft per environment/account/Group, and single-Expense ledger creation. It did not find persistent server Draft storage, a Draft API, an MCP endpoint or the proposed actor-scoped operations module. Existing local recovery and financial idempotency are useful foundations, not the completed feature.

The October 1 proposal uses stateless preview tokens without storage. That cannot satisfy persistent collections. It also allows revoked JWT access until expiry, which does not satisfy the selected revocation behavior. Both differences need explicit implementation changes.

## Proposed implementation order

1. **Verify the integration dependencies.** Recheck official protocol, SDK and Better Auth package documentation and peer compatibility at implementation time. Prove discovery, consent and one authenticated read against actual ChatGPT and Claude accounts in staging. Previous research is not a live interoperability test.
2. **Establish shared authorization boundaries.** Give web routes and MCP tools actor-aware operations, current Group membership checks and consistent ledger behavior. Decide how recurring-expense materialization is represented before labeling tools read-only; the existing GET behavior can write ledger data.
3. **Build persistent Draft operations.** Implement owner and Group isolation, partial input validation, revisions, exact retry identity, capacity enforcement and permanent discard. Keep incomplete Draft validation separate from complete Expense validation.
4. **Implement conversion into Expenses.** Bind saving and duplicate acknowledgment to the reviewed Draft revision. Reuse ledger rules and exact money handling. Preserve a durable outcome mapping so lost responses, repeated clicks and concurrent clients still produce one Expense per Draft.
5. **Deliver web and Android review together.** List, edit, retain incomplete entries, acknowledge duplicate warnings, discard permanently and save selections with per-item results. Show which actions occurred via a Connected assistant without exposing private Drafts to other members.
6. **Add MCP Draft tools and connection management.** Enforce the separate Draft grant, all-current-and-future-Group consent language, permanent-discard capability and immediate request rejection after revocation. Grant status cannot rely solely on locally verified JWT expiry.
7. **Run end-to-end acceptance.** Verify both review clients and both assistant hosts against staging, including failure and reconnect cases. Public directory publication remains separate release work.

The compatibility spike can run before the Draft work to expose platform blockers early. The feature is not launch-ready until both review clients and the full authorization path pass acceptance.

## Engineering gates

These are implementation obligations and recommendations, not additional product decisions:

- **Concurrent saves and discard:** enforce ownership, current membership and the reviewed revision at the mutation boundary. Saving versus discarding the same Draft must have one coherent outcome. A discarded creation request must not resurrect the Draft when retried.
- **Capacity races:** simultaneous creation requests cannot exceed 100 active Drafts. Recommend rejecting an over-capacity batch without creating its new Drafts, with an explicit capacity error. Invalid individual items need indexed outcomes; never silently truncate a request exceeding 10 items.
- **Partial save recovery:** report each Draft as saved, failed or unresolved. For an unknown outcome, retry the same operation identity. Never treat a network timeout as evidence that nothing was recorded.
- **Local handoff:** preserve the local payload and operation identity until server acknowledgment. Resolve any existing unconfirmed ledger save before uploading its contents as a new Draft. Avoid automatic cloud/local merges.
- **Deletion lifecycle:** integrate Draft writers with the transaction fence in ADR 0007 and add Draft content to Group cleanup. Deletion must not race with a late assistant write and resurrect content. Keep any necessary minimal replay metadata separate from discarded Draft content.
- **Revocation boundary:** requests authorized after revocation must fail. Document and test the treatment of already-running requests; check grant status at the write boundary. Completed operations are not rolled back by disconnecting.
- **No misleading privacy promises:** permission removal blocks new server access; it cannot erase content previously returned to a chat or device.
- **Client separation:** hide another member's Draft existence and contents. Ledger-only grants must not enumerate Drafts. An assistant may operate only on the authenticated member's Drafts.

## Acceptance examples

1. Ask for three Goa expenses, close chat, and review the same three Drafts on web and Android the next day.
2. Retain a taxi Draft without a payer; saving fails for that item without inventing a payer or blocking other valid selected Drafts.
3. Change an amount on Android, then attempt the assistant's stale edit or a stale web save; both require refreshed review.
4. Retry an acknowledged or unacknowledged creation/save request; it produces no second Draft or Expense.
5. With 95 active Drafts, attempt concurrent bulk additions; the server never exceeds 100. Reject a creation request containing 11 items.
6. Discard permanently through an authorized assistant; it disappears on refreshed clients, cannot be restored and is not recreated by retrying the original request.
7. Revoke the assistant; further requests fail even with an otherwise unexpired token, while the member can still review the Drafts.
8. Remove membership or delete the Group during a Draft operation; authorization and deletion boundaries prevent unauthorized writes and orphaned Draft content.
9. Go offline on Android, retain local form recovery and reconnect; no upload or ledger save occurs until explicitly requested.
10. Try a ledger-only connection against Draft tools and another member's IDs; neither exposes private Draft contents or permits mutation.

## Readiness conclusion

The product scope is concrete enough for final shared-understanding confirmation. Implementation still requires persistent Draft infrastructure, two review interfaces and verified MCP authorization. The next work should be the compatibility spike and backend foundation, with existing plan files preserved.
