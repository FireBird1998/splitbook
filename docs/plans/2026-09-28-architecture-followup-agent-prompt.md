Implement the approved Splitbook Group-response and ledger-creation follow-up work.

Repository: /Users/ankitdas/AnkitPersonalProjech/SplidBook
Canonical tracker: FireBird1998/splitbook (private); main is the authoritative base.

Read AGENTS.md, CONTEXT.md, the relevant ADRs, and these documents before editing:

- /Users/ankitdas/AnkitPersonalProjech/SplidBook/docs/specs/2026-09-28-group-response-consistency.md
- /Users/ankitdas/AnkitPersonalProjech/SplidBook/docs/specs/2026-09-28-ledger-creation-coordination.md
- /Users/ankitdas/AnkitPersonalProjech/SplidBook/docs/plans/2026-09-28-architecture-followup-tickets.md

Publication status: APPROVED AND PUBLISHED. The user approved both specifications, the testing seam and all six tickets. Use the published GitHub issues as the cross-checkout source of truth; local documents are supporting copies.

Parent specs:

- #72: https://github.com/FireBird1998/splitbook/issues/72
- #73: https://github.com/FireBird1998/splitbook/issues/73

Ticket order and blockers:

- #74 — Validate Group lists consistently on web and Android: https://github.com/FireBird1998/splitbook/issues/74. Blocked by: none.
- #75 — Validate Group details and settings across clients: https://github.com/FireBird1998/splitbook/issues/75. Blocked by: #74.
- #76 — Verify complete Group read compatibility and recovery: https://github.com/FireBird1998/splitbook/issues/76. Blocked by: #75.
- #77 — Characterize Expense and Settlement retry failures: https://github.com/FireBird1998/splitbook/issues/77. Blocked by: #70.
- #78 — Unify safe postcommit Activity ordering and narrow retry coordination: https://github.com/FireBird1998/splitbook/issues/78. Blocked by: #77.
- #79 — Verify ledger creation and recovery end to end: https://github.com/FireBird1998/splitbook/issues/79. Blocked by: #78.

Group and ledger tracks have no dependency on each other. Read issue bodies, comments and native blocking links; work only tickets whose blockers are complete. Start #74. Ledger #77 requires completed #70 and its verified, accepted revision as the baseline. If #70 remains open, complete independent Group work and report that precise blocker without bypassing it.

Working rules:

- Inspect the active checkout, git state and current work before editing. Preserve user changes, environment files, persistent local Mongo data and concurrent agent work. Use a suitable isolated checkout when needed; do not reset or clean another agent’s work.
- Use subagents for independent review, fact-finding or disjoint implementation when useful. Keep one integration owner and avoid overlapping edits. You own integration and final thorough verification.
- Implement from the approved specs without editing their requirements. Keep parent specs open and unmodified. Do not absorb earlier Expense or separate Android feature tickets into this scope.
- Group reads use one pure shared definition with existing wire IDs/timestamps and per-client adapters. Invalid required data fails visibly with Retry for the whole response. Preserve documented optional defaults, historical Tags, supported currency/Theme checks, ownership, cache/logout safeguards, existing routes and recurring generation. No silently filtered Groups or fabricated currencies/members.
- Characterize ledger behavior before refactoring. Preserve Expense/Settlement eligibility differences, immutable historical Tag replay, actor/Group-scoped keys, creation fingerprint array order, currency-lock ordering, current-record replay and legacy unkeyed behavior.
- Commit financial records with recoverable Activity intent; attempt bounded Activity publication before response preparation on creation/replay/collision recovery. A failed response after commit must remain retryable without another financial effect.
- Keep two explicit creation operations. Extract common internal coordination only if it reduces duplicated caller knowledge. If it needs a hook for every policy or merely adds indirection, retain explicit writers and document the evidence; still deliver the approved ordering change and tests.
- Leave production Google setup, credentials, deployments and production data alone. Preserve the intentional silent fork; do not sync with or compare against the original repository.

Verification is required, not an optional follow-up:

- Main seam: authenticated requests through an isolated actual app and disposable real MongoDB; inspect authorized records, Balances and Activity. Feed real Group responses through both adapters.
- Supplement with decoder edge cases and real-Mongo creation fault injection for postcommit response failure, publication outages, acknowledgement failure and unrelated unique collisions. Never add production fault endpoints.
- Run browser list/detail/settings/error/Retry journeys, Expense and Settlement lost-response recovery, concurrent retries, conflicts, historical Tags, participant departure and account isolation. Assert one financial effect and eventual single Activity where promised.
- Run required lint/format/type checks, relevant shared/web/mobile and regression suites, applicable builds, desktop/mobile viewport and accessibility checks. Retain the native controller smoke journey and distinguish it from actual Android device testing. Do not claim production OAuth verification from mocked auth.
- Record the tested revision, exact commands and outcomes, proof of the required financial invariants and any limits. Investigate failures; do not weaken assertions or claim an unavailable check passed.

Deliver reviewed code and a PR with a concise description, verification evidence and ticket links. Attach any created PR to your chat. Do not merge or deploy automatically. Report completed tickets, remaining blockers, the consolidation decision and any genuine limitations. Do not ask again about choices already settled in the specs.
