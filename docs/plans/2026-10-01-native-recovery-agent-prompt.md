# Agent prompt for Android draft recovery and navigation

Implement [issue 104: Android draft recovery, history and return navigation](https://github.com/FireBird1998/splitbook/issues/104) in `FireBird1998/splitbook`. Read its current body, comments and blocking dependencies, plus [parent specification 99](https://github.com/FireBird1998/splitbook/issues/99). Deliver the complete issue as one focused draft PR with regression tests and Android verification.

## Scope and concurrent work

Another agent owns issue 100 (required-field corrections) and issue 102 (stable refresh). OpenDesign prototype work is also underway separately. This assignment owns only issue 104: return navigation, ordinary draft-resume messaging, uncertain-save recovery presentation, and readable Expense edit history.

These issues are independent in the tracker but may touch the same controller and screens. Work in a separate worktree and branch from current main, after checking existing worktrees, issue ownership and related PRs. Preserve other agents' changes and keep edits narrow. Avoid whole-controller rewrites, broad formatting, form-validation changes, cache migration, new bottom navigation, or design-system replacement. If shared changes become a real dependency, document it rather than copying another agent's unfinished implementation.

Read applicable AGENTS.md, CONTEXT.md and the mobile ADR. The primary checkout is `/Users/ankitdas/AnkitPersonalProjech/SplidBook`. If present, read `docs/qa/2026-09-30-native-usability-audit.md` there for reproduction evidence. Local QA documents may be untracked and absent from a fresh worktree; preserve them. GitHub issue acceptance criteria remain authoritative.

## Behavior to deliver

1. **Return to the originating view.** Leaving an Expense through header Back or Android Back restores its known Group, selected Household Month and appropriate scroll context. Preserve a meaningful existing origin, including Activity when applicable. Direct entry without an origin has an explicit safe fallback. Denied or removed Groups must not reappear through navigation history.
2. **Clear ordinary draft resume.** Resume keeps every entered value and removes obsolete “resume or discard” warnings. Clear only messages that are no longer applicable; retain actionable storage, access or conflict feedback. Preserve one draft per account and Group.
3. **Keep uncertain saves distinct.** An ordinary unsaved draft must not be presented as a possibly committed submission. A submission with a lost response must retain its immutable attempted payload, retry identity and applicable revision protection. Preserve explicit review and retry; reconnect, restart and navigation must not automatically send financial writes.
4. **Readable edit history.** Present concise changes using member names, formatted money with currency, and readable dates. Handle former/unavailable members and historical data safely. Preserve historical values and allocations; formatting must not recalculate the ledger. Replace raw JSON and database identifiers with meaningful descriptions or a safe generic fallback for unsupported historical fields.

## Verification

Start with meaningful failing regressions at the existing public-controller boundary for incorrect return context and stale resume feedback. Add focused history-rendering tests for money, dates, member changes, unavailable members and unsupported fields. Assert user-visible behavior rather than private state layout.

Cover create/edit entry, current and past Month, direct entry, ordinary draft restart, uncertain create/edit recovery, stale revision conflict, sign-out or access denial, and a response completing after navigation. Verify that navigation and presentation cannot discard a draft, change a submitted payload, duplicate a write, or restore another account's content.

Run relevant regression suites and required type, lint and formatting checks. Use ADB for an installed Android development/staging journey with clearly named QA data. Coordinate emulator use if another agent is actively testing; avoid replacing its APK, force-stopping its app or altering shared test records during its session. Continue controller tests and implementation while a device is occupied. Ask the user to complete Google sign-in if needed.

Capture evidence of Group/Month → Expense → Back, restart → Resume, readable history, and the available recovery journey. Distinguish real device verification from simulated transport tests and report remaining gaps explicitly.

## Delivery

Open and attach one draft PR referencing issue 104. Include the concrete before/after behavior, acceptance-criterion results, tests, device evidence, and any shared-file integration risks with the other agents' PRs. Preserve existing plans and unrelated issues. Stop with a reviewable PR; do not merge, deploy, close the issue prematurely, or begin another ticket.
