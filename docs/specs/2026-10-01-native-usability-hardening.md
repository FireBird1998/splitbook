# Android usability hardening specification

Status: draft for tracker publication. Based on the completed native usability audit and background-refresh research. Existing plans are preserved.

## Problem Statement

Members cannot reliably tell what an Expense needs before it can be saved. Description is mandatory but not labelled required, and submitting it blank produces a generic correction that does not mention Description. Editing exposes technical validation details instead. Errors can be far from the relevant field. Previously loaded financial content disappears during refresh, and multiple loaders make ordinary use feel continuously busy.

The existing controller tests protect financial correctness but do not establish understandable correction, stable screen content, keyboard access, or accessible error presentation. Members need these everyday flows to be predictable before using the Android beta routinely.

## Solution

Explain required fields before submission, identify each invalid value beside its control, and take the member to the first correction without losing their draft. Keep matching authorized content visible during background refresh, with honest freshness and one appropriate progress cue. Reduce duplicate reads and make native navigation, draft recovery and history understandable. Apply the same feedback to Group creation and Settlement entry.

Use a focused OpenDesign prototype for the compact native surface and bottom navigation. Adopt TanStack Query only through a separate bounded read pilot; the reported defects must not wait for a full cache migration.

## User Stories

1. As a member, I want required Expense fields identified, so that I know what is needed before saving.
2. As a member, I want optional details distinguished from required values, so that I can enter a simple Expense quickly.
3. As a member, I want blank or whitespace-only Description explained at the field, so that I can correct it immediately.
4. As a member, I want local input errors shown without waiting for a connection, so that poor connectivity does not hide a simple correction.
5. As a member, I want create and edit to explain the same invalid input consistently, so that I do not need to understand technical errors.
6. As a member, I want the first invalid field brought into view, so that I can correct a long form without searching.
7. As a screen-reader user, I want errors associated with their controls and announced concisely, so that I can complete the form independently.
8. As a member, I want currency precision explained without silent rounding, so that the recorded amount matches my intent.
9. As a member, I want a usable date control and impossible-date feedback, so that I do not need to memorize a date format.
10. As a member, I want an unavailable Tag explained without substitution, so that my Expense retains its intended classification.
11. As a member, I want missing payers or participants identified, so that I know who must be selected.
12. As a member, I want invalid payer and split totals explained in their editors, so that I can make the full allocation balance.
13. As a member, I want drafts preserved through correction and restart, so that fixing one field does not repeat my work.
14. As a member, I want disabled Save actions explained, so that I know whether local storage or an active submission needs attention.
15. As a member, I want loaded content to remain visible while it refreshes, so that I can keep reading.
16. As a member, I want automatic refresh to be quiet, so that routine use does not look like a stalled operation.
17. As a member, I want manual refresh and pagination to have appropriate progress feedback, so that I can see the result of my action.
18. As a member, I want cached figures labelled with their real freshness, so that previous values are not mistaken for current Balances.
19. As a member, I want an uncached offline view to explain its unavailability, so that I am not left watching a loader.
20. As a Household member, I want a selected Month to show only its Expenses, so that changing Month cannot mislabel the previous list.
21. As a Household member, I want running Balances to remain all-time, so that Month selection does not imply a settled ledger.
22. As a member, I want recurring-generated Expenses reflected before fresh Balances are shown, so that the two views agree.
23. As a member, I want repeated foreground events to reuse an in-flight read, so that the app avoids unnecessary waiting and traffic.
24. As a member, I want confirmed ledger changes reflected in affected summaries and Activity, so that a prior response cannot restore obsolete figures.
25. As a member, I want stale content removed when access is denied or accounts change, so that caching cannot expose another account's data.
26. As a member, I want returning from an Expense to restore its Group and Month, so that I can continue where I left off.
27. As a member, I want ordinary draft resume distinguished from uncertain-save recovery, so that I understand whether an Expense may already exist.
28. As a member, I want readable edit history with names and formatted amounts, so that I can understand a correction.
29. As a member, I want compact selectors and a keyboard-aware Save action, so that the Android form is comfortable on a small display.
30. As a member, I want clear Group-name validation, so that an inactive creation action does not leave me guessing.
31. As a member, I want Settlement errors and review to identify the actual payer, recipient, currency and amount, so that I record the intended payment.
32. As a member, I want explicit retry after an uncertain submission, so that reconnecting never creates an unreviewed financial write.
33. As a member using large text or dark mode, I want the same clear hierarchy and accessible controls, so that these improvements work with my preferences.
34. As a maintainer, I want behavior-level regressions and measured device evidence, so that passing tests demonstrate correction and stable content rather than merely a nonempty error message.

## Implementation Decisions

- Retain React Native/Expo, shared pure financial rules, the current backend, authentication and staging isolation. No ledger schema or public API change is assumed.
- Local validation yields structured field feedback. Current-member, Tag, currency, authorization and record-revision checks remain authoritative live checks before a write. Do not duplicate shared money arithmetic in UI logic.
- Extend native field presentation for required/optional labels, hints, errors, focus and accessibility. Show errors after interaction or submission, retain partial typing, and use the same friendly mapping for create and edit.
- Keep Save available to explain incomplete input. An active submission or unresolved durable-storage requirement can disable it with an explanation. Preserve immutable attempts, original revisions and explicit retry semantics.
- Model content availability separately from request activity, freshness, last refresh error and request origin. Retain only matching authorized content during refresh. Initial, manual, background and pagination states receive distinct progress treatment.
- Preserve Expense-read/materialization-before-Balance ordering. Previous Balances can remain visible as stale/updating, but must not become fresh Settlement suggestions. Month filters apply to Expenses only.
- Coalesce identical in-flight reads. Use an initial proposed 30-second display freshness window subject to measurement; manual refresh and confirmed mutations bypass it. Display freshness never extends session or membership authority.
- Hydrate validated account/environment/resource-scoped cached data with original timestamps. Preserve denial eviction, cleanup markers, sign-out ordering and protection against late responses or persistence writes.
- Native compact layout and navigation follow a reviewed OpenDesign Local Codex prototype, including invalid, offline, empty, loading and recovery states in both themes. Prototype work cannot block functional validation and loading fixes.
- Preserve the one-draft-per-account/Group model. Restore known navigation origin and Month, remove obsolete resume warnings, and present history in human terms without raw JSON or database identifiers.
- Reuse field feedback for Group creation and Settlement entry. Settlement still records a payment that already occurred, with explicit acknowledgement above the latest suggestion.
- An optional TanStack Query Activity pilot transfers one complete read resource's ownership at a time. Do not wrap the existing fallback helper, retain two independent cache owners, persist financial mutations, or automatically resume them. Full ledger-cache migration requires a later evidence-based decision.

## Testing Decisions

- Preserve the already accepted highest acceptance seam: the installed Android app through the real isolated backend, with authorized subsequent reads verifying saved results. No new backend seam is required by this spec.
- Reuse public-controller tests with controllable transport and account storage for local validation, refresh state, request coalescing, Month identity, interruption and authorization races. Assert observable messages, retained data and requests, not private helpers.
- Add rendered native interactions where needed for field-associated feedback, focus/scroll, correction and disabled-action explanation. This complements, rather than replaces, installed-device checks.
- Retain shared money and backend reliability suites. Invalid local input must cause no financial write; confirmed saves and explicit retries must retain existing once-only effects and revision protections.
- Prior art includes Expense/Settlement recovery tests, offline account-isolation tests and financial Month/materialization ordering tests. Convert the audit's characterization cases to desired-behavior regressions as fixes land.
- Verify TalkBack, larger text, small display, keyboard, light/dark, Android Back, restart and slow/offline/reconnect behavior on emulator and phone. Use two authorized staging accounts for split and Settlement journeys.
- Record initial/warm load time, blank-content duration, overlapping loader count and request count. Report unsupported or blocked checks explicitly; do not infer full release readiness from unit tests.

## Out of Scope

- Automatic offline financial writes, automatic conflict merging, payment processing, foreign-exchange netting, or new ledger semantics.
- A wholesale controller replacement or mandatory full TanStack Query migration.
- Receipt OCR work already tracked separately; native recurring, Tag or member administration expansion.
- Production deployment, data cutover, public store release, or iOS release certification.
- Closing older parent specifications or marking existing release gates complete by inference.

## Further Notes

The audit reproduced missing Description guidance on the signed emulator build. All 214 existing mobile tests passed; eight temporary characterization cases confirmed current defects. Draft restart and precision feedback were observed natively. Two-account, accessibility and performance checks remain explicit acceptance work.

Functional fixes can start independently of OpenDesign availability. The Query pilot is optional follow-up and not a prerequisite for shipping the correctness and usability fixes. Publish implementation tickets only after their breakdown is reviewed under the requested ticketing workflow.
