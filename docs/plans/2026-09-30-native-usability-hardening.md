# Android form and refresh improvement plan

Make Expense entry self-explanatory and keep the app stable while data refreshes. Start with the confirmed validation and loading defects, then refine the native layout. A wholesale controller rewrite is unnecessary for the first improvements.

This is a proposed implementation sequence following the [QA audit](../qa/2026-09-30-native-usability-audit.md). It does not modify previous plans or represent approved/generated OpenDesign screens. The [research note](../research/2026-09-30-native-background-refresh.md) covers the TanStack Query decision and official sources.

## First deliverable

A new Expense form should identify Amount, Description, date, payer, participants, and Tag as required values, while clearly showing existing defaults. Notes and Category belong in optional details. Empty fields should not look erroneous before the user interacts with them. On submit, reveal all relevant errors and move to the first one; subsequent edits update that field's feedback.

Example correction: **Description · Required** with “What was this for?” and, after invalid submit, “Add a description, such as Groceries.” Save remains available when inputs are incomplete so it can explain the missing information. Disable it only during an active submission or an unresolved local-storage requirement, with a nearby explanation. The actual write remains blocked until validation and authorized live-context checks succeed.

## Implementation sequence

### 1 Clear validation across creation and editing

Add a typed field-error result for Amount, Description, date, Tag, payer, and participants/split. Reuse shared domain validation; avoid a second money-calculation implementation. Separate local structural validation from the live checks for membership, current Tag availability, currency, and revision.

Extend the shared native Field presentation with required/optional copy, hint, error, and focus support. Render concise messages next to fields and a compact submit summary. Apply the same mapping to create and edit; never render serialized validation exceptions. Revalidate touched fields after correction and avoid aggressive errors during normal partial typing.

Acceptance:

- Blank/whitespace Description identifies that field before any network call; no POST/PATCH occurs.
- Invalid/zero/negative/excess-precision amount gives a currency-appropriate correction without silent rounding. Test currencies with different minor units.
- Impossible/empty date is explained near Date; a native date picker becomes the preferred entry surface.
- Missing/retired Tag, no participants, missing payer, inconsistent split and payer totals identify the correct control or editor.
- The first invalid field is visible and reachable with the keyboard open and TalkBack enabled. A summary announces the problem without reading raw JSON.
- User input survives every rejected submission; correcting an error does not erase unrelated entries.

### 2 Preserve content during refresh

Separate data availability from request activity, freshness, and request origin. Keep a coherent prior snapshot for the same authorized account, Group, and filter visible while it refreshes. Use a full placeholder only for an uncached initial view. A failed background request retains the prior snapshot with its original refresh time and an actionable warning.

Use the native refresh spinner only for a user's pull gesture. Automatic refresh gets one quiet status indicator; pagination gets a footer. Suppress competing full-section spinners during these operations.

Acceptance:

- Same-view refresh never blanks loaded content; automatic refresh never activates the pull indicator.
- A genuinely uncached view has a bounded initial loading state, then content or an explicit unavailable/error state.
- Changing Month never displays the previous Month's Expenses under the new label. Running Balances remain all-time.
- Recurring materialization keeps its dependency order: Expense read, then Balance read. Retained Balances are marked as previous/updating until verified; they are not presented as a fresh settlement suggestion.
- Access denial immediately removes affected protected content. No retention rule overrides sign-out, account changes, or authorization failure.

### 3 Coalesce reads and introduce deliberate freshness

Create one owner for each read resource. Coalesce overlapping same-key requests and avoid redundant foreground refreshes. A proposed starting freshness window is 30 seconds for ordinary display reads; measure and tune it. Manual refresh and confirmed ledger changes bypass it. Session and membership authority are not extended by display freshness.

Hydrate validated persisted data before background revalidation, preserving its original timestamp. Account, environment, Group and actual expense filters belong in resource identity. Never reuse another identity's data as a placeholder. Keep network failures distinct from authoritative denials and server errors.

Acceptance:

- Two simultaneous refresh requests produce one in-flight read per identical resource, without suppressing needed later invalidation.
- Foreground/reconnect does not submit financial writes and does not interrupt an unfinished draft.
- Confirmed create/edit/delete/Settlement invalidates affected Expense pages, Month summaries, running Balances, Home totals and relevant Activity; delayed pre-write responses cannot overwrite newer state.
- Slow/offline requests terminate in an understandable state; no indefinite loader from a paused request.
- Record cold/warm timing, blank-content duration, overlapping loaders and request count. Set final performance targets from those measurements, rather than inventing a speedup.

### 4 Make the native entry and recovery flow compact

Use OpenDesign with the already selected Local Codex mode for a focused prototype when its connector is available. The design must show invalid input and slow/offline recovery states, not only populated happy-path screens. Keep semantic tokens, Outfit/IBM Plex Mono, both themes, clear currencies, and native bottom navigation as the agreed direction.

Proposed surface: Amount and Description first; compact date, payer, split and Tag rows; bottom sheets for selections; an allocation summary; a keyboard-aware Save action. Avoid a long wall of Tag buttons. Keep optional details collapsed initially. Preserve the current one-draft-per-account/Group policy.

Acceptance:

- Returning from Expense goes to its Group and selected Month with scroll context, when that origin exists.
- Draft resume clears obsolete warnings. Uncertain submission recovery remains visibly distinct from an ordinary unsaved draft.
- Edit history names people and formats money/dates; no database identifiers or raw JSON changes appear in the user flow.
- Repeated Save taps produce at most one logical submission; lost-response retry retains the exact original body and identity.
- Small screen, enlarged text, TalkBack, dark mode, Android Back and keyboard behavior are reviewed on device.

### 5 Apply the same feedback rules to adjacent flows

Use the same form components for Group creation and Settlement entry. Explain a missing Group name instead of silently disabling its action. Payments must continue to say they record a payment that already happened; show payer, recipient, currency and amount in review, and preserve explicit overpayment acknowledgement. Review invitations, empty states and inaccessible Groups for a clear next action.

Acceptance: each error names the affected field or action, preserves recoverable entries, explains disabled controls, and supports a successful correction without restarting the journey.

### 6 Introduce TanStack Query incrementally if justified by the pilot

TanStack Query is compatible with React Native and is a reasonable direction for server reads. Fixes 1–3 do not need to wait for its adoption. Start with one bounded read domain, such as Activity, after mapping its invalidation dependencies. Transfer that resource's fetching, state and invalidation together; remove its competing controller cache owner.

Keep drafts, session management, and immutable write recovery outside the pilot. Do not wrap the current network-fallback helper as a query function: it would report old offline data as a newly successful read. Preserve persisted timestamps and authorization cleanup through an explicit adapter. Wire native connectivity and foreground listeners once.

Acceptance: the pilot passes the same offline/auth/request-count gates, does not add a second persistence owner, and cannot replay financial mutations on reconnect. Migrate the coupled Expense/Balance reads only after these checks pass. A library change is not evidence of better UX until measured on device.

## Release checklist

Promote the characterization findings into meaningful regressions for desired behavior, rather than merely checking that an error string exists. Add rendered form interaction tests and repeat the following Android journey on an emulator and the user's phone:

1. Open a test Group, submit an incomplete Expense, correct each error without losing the draft, and save once.
2. Edit it, trigger an invalid edit, correct it, inspect readable history, and test delete confirmation/cancellation.
3. Use two members to exercise unequal/exact/percentage/share splits, multiple payers, and Settlement review.
4. Restart during an ordinary draft and a lost-response recovery. Confirm explicit retry cannot duplicate an Expense or Settlement.
5. Switch Month, use an uncached Month offline, reconnect, and foreground repeatedly. Check stable content, honest freshness and all-time Balances.
6. Revoke Group access and switch accounts; ensure stale content cannot reappear from memory, disk or a late response.
7. Repeat core form paths with TalkBack, larger text and the keyboard visible, in light and dark themes.

Ship in small reviewable changes: validation first; refresh presentation and request coalescing next; native layout/recovery polish afterward. Query adoption is a separate architectural step with its own evidence. Fresh authenticated emulator checks reproduced the missing-Description guidance and verified precision feedback; remaining multi-account, accessibility and performance gates are listed in the audit. This is not a blanket release approval.
