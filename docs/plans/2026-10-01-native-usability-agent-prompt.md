# Agent prompt for the first Android usability fixes

Implement the first two independent Android usability fixes in `FireBird1998/splitbook`, in this order:

1. [Required Expense fields and actionable corrections — issue 100](https://github.com/FireBird1998/splitbook/issues/100).
2. [Keep financial content visible during refresh — issue 102](https://github.com/FireBird1998/splitbook/issues/102).

The [parent specification — issue 99](https://github.com/FireBird1998/splitbook/issues/99) and each issue's current acceptance criteria are authoritative. Read their complete bodies, comments and native blocking dependencies before implementing. Deliver working fixes, relevant regression tests, device evidence and one focused draft PR per issue. Finish the first issue's implementation and verification before starting the second. Stop after these two PRs are ready for review; merging and deployment are separate actions.

## Establish the baseline

Read the applicable AGENTS.md, CONTEXT.md and mobile ADR. Inspect the current repository state, active worktrees and issue ownership; preserve unrelated changes and avoid duplicating work already in progress. Use current main as the integration baseline in suitable isolated checkouts. If a necessary fix exists only in another unmerged PR, identify that dependency explicitly rather than silently importing its unrelated changes. Follow the repository's issue-claiming and implementation/review conventions.

The local checkout is `/Users/ankitdas/AnkitPersonalProjech/SplidBook`. For investigation evidence, read these local documents if present:

- `docs/qa/2026-09-30-native-usability-audit.md` — reproduced failures and screenshots.
- `docs/plans/2026-09-30-native-usability-hardening.md` — intended behavior and preserved financial constraints.
- `docs/research/2026-09-30-native-background-refresh.md` — why the existing cache does not prevent refresh loaders.

These documents may be untracked in the primary checkout and absent from a fresh worktree. Read them from the primary checkout when needed, preserving their contents. Published issues remain the portable source of requirements.

## First issue: required-field corrections

Reproduce the actual bug: a new Expense with a valid amount and Tag but empty Description is rejected with a generic message that omits Description. A blank Description during editing can instead expose serialized validation details.

Create meaningful failing regressions for the desired correction behavior, then implement consistent field feedback for create and edit. Test blank and whitespace-only Description, invalid currency precision, impossible date and missing/unavailable Tag. Basic local errors must be identifiable before a network request; live authorization and current-context checks still run before a valid write.

Make required fields visible, preserve partial typing and unrelated values, show concise errors beside their controls, and bring the first invalid field into view with the keyboard open. Explain disabled actions for storage/submission states. Reuse shared financial validation rather than duplicating money rules. Add focused rendered interaction coverage for error association and correction; a merely nonempty error string is insufficient.

## Second issue: stable refresh

Reproduce loaded Home/Group financial content disappearing during refresh and the native pull indicator appearing alongside section loaders.

Separate content availability from request activity and freshness. Retain matching authorized content on a same-view refresh; use distinct initial, manual, background and pagination feedback. Background failure must preserve the original refresh timestamp and provide an actionable message.

Preserve the existing dependency: Expense reads can materialize recurring entries, so fresh Balances must follow them. Retained figures must be clearly stale/updating until verified. Household Month selection filters Expenses only; never show the previous Month's Expenses under a new Month label. Authorization denial and account changes must still evict protected content, including against late responses.

This issue is presentation and state behavior. Request coalescing/cache freshness belongs to issue 103, and the optional TanStack Query pilot belongs to issue 108. Keep those changes out of these PRs. OpenDesign and the larger navigation redesign are separately tracked and do not gate these fixes.

## Verification and delivery

For each issue, run relevant public-controller, shared-domain and rendered interaction tests, plus required type, lint and formatting checks. Use the installed Android app against an isolated development/staging backend for the applicable acceptance journey. ADB is approved for emulator QA; use temporary, clearly named QA data and preserve existing user records. If Google sign-in is required, ask the user to complete it while continuing independent work.

Protect online-only financial writes, durable drafts, immutable attempted payloads and explicit retries, revision conflicts, account isolation and sign-out cleanup. Refresh/reconnect must never replay a financial write. Preserve current Google authentication and both visual themes.

Report each acceptance criterion as verified or explicitly blocked. Include emulator evidence for incomplete-submit → correction, draft persistence, initial load versus refresh, and relevant keyboard/back behavior. Do not equate controller tests with completed TalkBack or physical-device verification.

Open and attach a separate draft PR for each issue with the concrete behavior change, verification results and remaining limitations. Reference its issue without prematurely closing it. Keep existing specifications and unrelated issues unchanged. Final handoff: PR links, test/device results, any blockers, and which dependent tickets can proceed once these changes are merged.
