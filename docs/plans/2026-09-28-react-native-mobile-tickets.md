# SplitBook Android — proposed tracer-bullet tickets

Status: draft for user review. Nothing has been published. Testing choices below are proposed and await the user's seam approval.

This breakdown implements the accepted Android-first React Native/Expo scope against the existing backend. It preserves Household Month as a read-only expense lens, keeps running balances independent of Month, and treats Settlements as records of payments that already occurred.

## Existing work and dependency interpretation

- Reuse [Mobile readiness: Expo plugin, trusted origins, multi-platform Google client ids](https://github.com/FireBird1998/splitbook/issues/36) without creating a second authentication-infrastructure ticket, relaxing its stated completion, or calling a subset complete. Development UI and tests can proceed with explicit fixture/development-persona sessions. Actual native Google sign-in and the distributed beta are gated by completion of this existing issue.
- Reuse [Create iOS and Android Google OAuth clients](https://github.com/FireBird1998/splitbook/issues/35) for owner-controlled identity setup and signing fingerprints. It remains an existing external gate with its present scope; no implicit issue split or partial completion is assumed. A later tracker refinement may separate platforms only if explicitly reviewed.
- Reuse the approved [ledger-hardening specification](https://github.com/FireBird1998/splitbook/issues/39) and [its existing tickets](https://github.com/FireBird1998/splitbook/issues/48). Their implementation is present in the dirty local checkout, but is not in the current commit and the tracker issues remain open. Review and integrate the relevant existing changes without folding unrelated work into mobile commits. A clean checkout from the current commit does not contain the hardened contracts.
- Existing ledger tickets are actual dependencies only where their behavior is required. The specification itself is context, not a code-completion gate. The existing complete-ledger verification ticket gates internal distribution; it already depends on the other ledger tickets, including read optimization, so those do not need redundant release edges.
- Production authentication cutover, production ledger migration, store publication, iOS release, and unrelated web cleanup do not gate development against the separate staging ledger.
- Each ticket inherits fictional data for development and tests, no production credentials or financial data, current membership enforcement, accessible Android controls, explicit currency, light/dark semantic styling, and verification through externally observable behavior.

## Proposed testing boundary

The primary new acceptance boundary is a native Android user journey through real authenticated HTTP requests into an isolated backend and test database. Assertions inspect user-visible results and subsequent authorized reads. Reuse the established backend request harness and shared exact-money tests; do not duplicate arithmetic implementation or test private component structure.

Add native Android device/emulator journeys for behavior that the browser cannot prove: secure session persistence, app restart, draft recovery, online-only financial submissions, Android back/keyboard interactions, large text, and light/dark rendering. Real Google sign-in and staging deployment are explicit device smoke checks, separate from synthetic CI identity tests. The exact native runner and CI invocation are implementation choices after checking current Expo support; no tool choice has been silently approved here.

## 01 — Open a shared Group in an Android development build

**What to build:** A developer or local tester can install the Expo development build, choose a fictional development persona, see that persona's Groups, and open a Group with its Theme and members. The native client connects to a real isolated development backend using its existing guarded persona sign-in. Only the identity is fictional; Group reads and membership come from the backend. Real Google sign-in and distribution are completed in ticket 11.

**Blocked by:** None — the existing guarded development-persona backend permits an integrated development journey without real Google credentials. Native Google readiness remains an unchanged external release gate.

**Acceptance criteria:**

- [ ] An Android development build runs the existing approved visual direction with working navigation and system back behavior.
- [ ] A clearly identified, development-only persona entry signs in through the existing guarded backend persona endpoint and uses its real session for ordinary API requests. It does not introduce a production authentication bypass or duplicate the existing mobile-readiness scope.
- [ ] Group list and selected Group content come from the real API, with loading, empty, inaccessible, and recoverable failure states. A single native data-access boundary normalizes JSON timestamps and per-currency DTOs and carries the session to ordinary API requests. Static response fixtures alone do not satisfy this ticket; provider-mocked tests do not claim real Google verification.
- [ ] A Group uses its Theme's language and header; Trip ornament does not appear on Household, Couple, Work, or General.
- [ ] Returning to the foreground exercises session/data revalidation through the real development backend; expired authentication leads to sign-in and denied membership does not leave newly fetched protected content visible. Ticket 11 verifies these behaviors with the real native session.
- [ ] Account-local state is isolated; sign-out clears the session and all current local financial state. Later tickets extend this same purge boundary for their new stored data.
- [ ] Demo authentication is available only in the guarded local development mode and absent from the distributed private-beta experience.
- [ ] Proposed verification: native development persona → Group list → Group detail, app restart, denied access, and sign-out against explicitly fictional isolated data; no real-provider verification is claimed.

## 02 — Review Home balances and Trip or Household expenses

**What to build:** A member can see money they owe and are owed on Home, open a Group's expenses and balances, and inspect a past Household Month without changing the running balance.

**Blocked by:** 01; [Keep Settlements and balances exact by currency](https://github.com/FireBird1998/splitbook/issues/42).

**Acceptance criteria:**

- [ ] Home separates money owed from money receivable and displays each currency independently rather than hiding obligations in one net number.
- [ ] Group expenses support loading more results and refreshing; record dates, member attribution, amounts, and currency are readable.
- [ ] Trip detail uses the approved itinerary strip; Household detail uses its neutral header and Month selector.
- [ ] Selecting a Household Month uses the viewer's calendar/timezone expense window and labels the monthly expense summary separately from running balances.
- [ ] Switching Month never resets, filters, or settles running balances; empty past Months remain understandable.
- [ ] Existing backend exact-money and currency separation responses are consumed without a competing client ledger calculation.
- [ ] Proposed verification: known seeded obligations in separate currencies, month boundaries, empty month, pagination, and unchanged running balance across Month selection.

## 03 — Create a Group and join through an invitation link

**What to build:** A signed-in member can create a Group with a Theme and currency, share its invitation link where permitted, and join a Group from a link without losing the destination during sign-in.

**Blocked by:** 01.

**Acceptance criteria:**

- [ ] Creation collects the existing backend-required Group fields and offers Trip, Household, Couple, Work, and General Themes with appropriate conditional details.
- [ ] Successful creation opens the new Group with its persisted Theme, currency, creator membership, and useful empty state.
- [ ] Authorized users can obtain and share the existing Group invitation link through Android sharing.
- [ ] Opening a link handles an installed app, sign-in continuation, invitation preview, explicit join, already-a-member, invalid or expired link, and permission-denied outcomes.
- [ ] Link handling does not bypass the private-beta allowlist or current Group membership authorization. Validate the invite environment and reject production or unsupported origins in the staging build; provide web fallback when the app is absent.
- [ ] A failure leaves entered Group information or the pending invitation recoverable without reporting success prematurely. Group create and invite-link generation have no generic automatic retry; after an uncertain create, refresh the Group list and ask the user to check it before creating another Group.
- [ ] Proposed verification: create → share → different persona joins → both read the same Group; rejected links and authentication interruption preserve the intended destination.

## 04 — Save an equally split Expense with a recoverable draft

**What to build:** A member can enter an Expense, preview an equal split, leave and resume the draft, and save it once even when the app restarts after the server accepted the request but its response was lost.

**Blocked by:** 01; [Preserve Tag identity across renames and recurring use](https://github.com/FireBird1998/splitbook/issues/43); [Make Expense creation retry-safe with recoverable Activity](https://github.com/FireBird1998/splitbook/issues/44).

**Acceptance criteria:**

- [ ] The form collects amount/currency, description, Group, payer, participants, date, required Tag, and supported optional details with keyboard-aware navigation.
- [ ] Equal-split preview and request validation use shared currency-aware exact-money logic; all allocations conserve every minor unit.
- [ ] One Expense draft is stored per Group and signed-in account; navigating away and restarting preserves it, and replacing or discarding it is explicit.
- [ ] Financial submission requires an online attempt; offline editing can preserve a draft but never queues an automatic write or shows a saved Expense.
- [ ] Before submission, the exact attempted payload and submission key are persisted together. Reopening or retrying an unresolved attempt resends that same attempt; it cannot silently become a new Expense or a changed payload under the old key.
- [ ] Confirmed success clears the resolved attempt/draft and refreshes affected Expense and balance views; validation, connectivity, and permission failures remain visible without discarding entered values.
- [ ] Tags are selected by stable identity, retain their current display name, and respect backend ownership and active/archived rules. Restored drafts revalidate membership, Tag, and currency rather than silently substituting invalid fields. Add backward-compatible machine-readable error identifiers where required; do not classify ledger recovery by matching human messages.
- [ ] Sign-out purges drafts, unresolved attempts, and their keys; another account cannot recover them. Explain that an unresolved result must be checked in saved history after signing back in once local recovery metadata is cleared.
- [ ] Proposed verification: equal split with remainder, validation correction, draft restart, lost-response restart/retry producing one Expense and one Activity, offline Save prevention, and account isolation.

## 05 — Save custom participant and payer allocations

**What to build:** A member can use every currently supported split method and multiple payers, inspect each person's resulting amount, and save an Expense that agrees with the web ledger.

**Blocked by:** 04.

**Acceptance criteria:**

- [ ] The native split editor supports equal, unequal, percentage, shares, and exact methods exposed by the existing domain model without inventing a different calculation.
- [ ] Multiple payers and participant selection work together with the chosen split method; total paid and total allocated equal the Expense amount.
- [ ] Currency precision, deterministic remainder placement, incomplete percentages, invalid shares, and duplicate members produce shared, actionable validation.
- [ ] Switching editors or dismissing a selection sheet preserves the composed draft; method changes do not silently retain incompatible values.
- [ ] Review shows the final per-member amounts before saving, and the returned Expense matches the preview.
- [ ] The same restart-safe submission and online-only rules from 04 apply to every supported allocation.
- [ ] Proposed verification: at least one successful save per supported method, multiple payers, invalid totals, indivisible amounts, and read-back agreement with backend responses.

## 06 — Inspect, edit, and delete an Expense without overwriting newer work

**What to build:** A member can open Expense detail, review its allocations and history, edit or delete it, and recover safely when somebody else changed the record first.

**Blocked by:** 05; [Protect Expense and recurring-template edits from stale writes](https://github.com/FireBird1998/splitbook/issues/46).

**Acceptance criteria:**

- [ ] Expense detail shows the complete record, participants, payers, Tag, notes when present, and available edit history through the authorized detail endpoint.
- [ ] Editing retains the record's actual currency, supported split method, stored allocations, and historical Tag association; an unrelated metadata edit does not redistribute rounding.
- [ ] Mutations carry the revision displayed to the editor and respect current backend membership checks.
- [ ] A stale result keeps the user's draft, displays the latest record, and requires explicit review before another save; no automatic merge or silent overwrite occurs.
- [ ] Delete requires a clear confirmation, preserves the backend's soft-delete semantics, and refreshes expenses, balances, and Activity after confirmation.
- [ ] Edit and delete are online-only, with failures distinguishable from successful mutations. Draft and revision recovery survive restart within the one-draft-per-Group rule.
- [ ] If the selected Expense is deleted or access is revoked elsewhere, the UI explains that current state and does not offer an unauthorized retry. After a lost edit/delete response, reread the authorized record, including its soft-deleted state; never fetch a fresh revision and silently replay the mutation. Use typed conflict responses compatible with existing web callers.
- [ ] Proposed verification: edit/read-back, metadata rounding preservation, two editors, stale delete, lost connection, restart, and removed membership through native actions plus existing authenticated request tests.

## 07 — Record an actual payment and see the remaining balance

**What to build:** A member can review a suggested debt, record all or part of a payment that already occurred, and see the resulting running balance without creating a second Settlement on retry.

**Blocked by:** 02; [Make Settlement retries and recurring Activity recoverable](https://github.com/FireBird1998/splitbook/issues/45).

**Acceptance criteria:**

- [ ] The recording flow identifies payer, recipient, amount, and currency, defaulting the amount to the suggested debt refreshed for review.
- [ ] A smaller actual payment can be recorded; an amount exceeding the current suggestion triggers an explicit warning and review before recording, while backend validation remains authoritative.
- [ ] The flow states that it records an existing payment and does not transfer funds or imply bank/payment-provider confirmation.
- [ ] Only permitted payer/recipient actions are available, with server authorization rechecked on submission and replay.
- [ ] Exact attempted payload and submission key survive a response loss and app restart. Retrying one unresolved attempt creates one Settlement and one corresponding Activity.
- [ ] Recording is online-only; no background replay occurs merely because connectivity returns. A changed suggestion is shown for review before a new action; it does not rewrite an unresolved attempt. No atomic debt snapshot or guaranteed fully settled outcome is promised; the actual amount remains the reviewed amount and the result comes from refreshed balances.
- [ ] Confirmed success refreshes running balances, Settlement history, and Activity; sign-out removes local unresolved attempts.
- [ ] Proposed verification: full payment, partial payment, explicit over-suggestion warning, unauthorized party, lost-response restart/retry, and exact currency-specific balance change.

## 08 — Follow Group Activity and inspect what changed

**What to build:** A member can read a Group's Activity timeline, distinguish Expense changes from recorded Settlements, and inspect the event's available details.

**Blocked by:** 01.

**Acceptance criteria:**

- [ ] Activity displays backend-provided actor, event, timestamp, and amount/currency where relevant with comprehensible loading, empty, refresh, and failure states.
- [ ] Event detail presents the available actor/action/record context and identifies historical or deleted records without representing the event snapshot as the current editable Expense.
- [ ] Refreshing reconciles recovered Activity from the backend without inventing duplicate local financial events or claiming missing events did not occur.
- [ ] Current membership controls access, including after the app returns to the foreground.
- [ ] Proposed verification: seeded mixed event timeline, deleted target, authorized refresh, and backend recovery visibility using the existing recovery fixtures.

## 09 — Set display preferences and leave the account cleanly

**What to build:** A member can use the supported Settings, select system/light/dark appearance, inspect account and environment information, and sign out with their local financial data removed.

**Blocked by:** 01.

**Acceptance criteria:**

- [ ] System, light, and dark choices persist and apply to the native flows through semantic tokens, including errors, sheets, money states, and enlarged text.
- [ ] Account information reflects the signed-in member. Links to deferred web administration remain in the configured staging environment; this ticket does not add profile editing, account deletion, or notification preferences.
- [ ] Settings clearly identify the connected non-production environment in development/internal builds without exposing secrets.
- [ ] Sign-out cancels and invalidates in-flight requests before clearing secure authentication, cached financial responses, drafts, and unresolved submission payloads/keys registered with the account-local storage boundary. Late responses cannot repopulate the cache or appear in a different account.
- [ ] Another account sees only its own data; app restart cannot resurrect the signed-out account's financial content.
- [ ] Proposed verification: preference restart/persistence, light/dark and large text, account display, and sign-out/account-switch isolation including late responses.

## 10 — Inspect cached financial views while offline

**What to build:** A previously signed-in member can reopen already loaded Home and Group information without connectivity, understand when it was last refreshed, and continue an Expense draft while financial writes remain online-only.

**Blocked by:** 02; 04; 08.

**Acceptance criteria:**

- [ ] Previously loaded Home, Group expenses, balances, and Activity remain readable after connectivity loss or app restart, with an explicit offline/stale state and last successful refresh information.
- [ ] A Group, Month, page, or detail that was not loaded is identified as unavailable offline rather than fabricated or replaced with misleading empty results.
- [ ] Cached content is scoped to the signed-in account and Group; sign-out purges it and account switching cannot reuse another account's cache.
- [ ] Expense drafting continues with available context, while create/edit/delete/Settlement submission is disabled or rejected visibly when offline and never enters an automatic mutation queue.
- [ ] Reconnection revalidates session/membership and refreshes stale data without silently destroying drafts, replaying writes, or marking an unresolved attempted submission complete.
- [ ] Access denied during revalidation removes the inaccessible cached Group content; an already disconnected device is not represented as having immediately learned about remote revocation.
- [ ] Proposed verification: warm versus cold cache, restart offline, unvisited Month, retained draft, restored connectivity, removed membership, and sign-out purge.

## 11 — Install the internal APK and sign in to the staging ledger

**What to build:** An invited tester can install the signed internal Android APK, sign in with an approved Google account, and use the completed native flows against the separate staging ledger. This slice verifies real native Google authentication and staging configuration in the distributable build. Earlier slices already use the real backend through development-only identities; this is not the first end-to-end backend integration.

**Blocked by:** 03; 06; 07; 09; 10; [Create iOS and Android Google OAuth clients](https://github.com/FireBird1998/splitbook/issues/35); [Mobile readiness: Expo plugin, trusted origins, multi-platform Google client ids](https://github.com/FireBird1998/splitbook/issues/36); [Rehearse migration and verify the complete ledger](https://github.com/FireBird1998/splitbook/issues/48). Other mobile and ledger dependencies are transitively covered. Existing external issues retain their scope/status until explicitly changed.

**Acceptance criteria:**

- [ ] A reproducible signed internal APK installs on the target Android device, uses the approved native Google identity/server audience configuration, and points only to a separate staging auth/ledger environment.
- [ ] Staging uses a reviewed integration baseline containing the relevant existing ledger contracts. Unrelated dirty-checkout work is excluded rather than swept into a mobile commit, and a clean checkout of the older current commit is not mistaken for that baseline.
- [ ] Approved accounts reach their staging Groups; unapproved accounts receive the private-beta denial. Cancellation and provider failure leave a recoverable sign-in state.
- [ ] Secure native session/cookie handling from the existing mobile-readiness work survives restart and sign-in continuation restores a pending invitation destination. App foreground revalidation handles expired sessions and removed membership.
- [ ] The distributed build has no development fixture or demo-persona entry, cannot silently fall back to sample data, and cannot accidentally target the live ledger.
- [ ] Sign-out follows existing auth policy and purges all account-local financial content, including drafts and unresolved submissions.
- [ ] One real approved and one real denied Google account are checked on the signed Android build. Synthetic CI identity coverage remains separately identified and cannot stand in for real-provider evidence.
- [ ] A connected smoke journey creates/joins a Group, saves an Expense, inspects its effect on balances, and records an actual payment. It proves that staging writes and subsequent native reads use the intended identity and ledger.
- [ ] Verification already owned by each behavior ticket remains its acceptance evidence; relevant integrated regressions run before distribution without turning this ticket into a replacement for unfinished feature work.
- [ ] Provide the APK, installation instructions, staging limitations, and verification evidence. Store release, production cutover/migration, iOS release, and actual funds transfer remain out of scope.

## Compact dependency map for user review

1. Open a shared Group in Android — no blockers; real isolated development backend with guarded fictional persona sign-in.
2. Review Home balances and Trip/Household expenses — 1 + exact balances.
3. Create a Group and join through a link — 1.
4. Save an equal Expense with draft/retry recovery — 1 + stable Tags and retry-safe creation (balanced money is a transitive prerequisite).
5. Save custom allocations — 4.
6. Inspect/edit/delete with conflict review — 5 + stale-write protection.
7. Record an actual payment — 2 + retry-safe Settlements.
8. Follow Group Activity — 1.
9. Preferences and clean sign-out — 1.
10. Cached offline viewing — 2, 4, 8.
11. Install internal APK with real Google sign-in to staging — 3, 6, 7, 9, 10 + existing OAuth setup, mobile readiness, and complete-ledger verification.

Review prompts: Does this granularity feel right? Are the dependencies limited to work that actually gates each slice? Should any slices be merged or split? Approve the proposed testing boundary separately before publishing the spec and tickets.
