# SplitBook React Native private beta

Status: draft for final understanding, testing-boundary, and ticket review. Product choices were accepted in two interview rounds on 27 September 2026. No implementation or tracker publication is claimed by this document.

## Problem Statement

SplitBook users need a phone app for keeping shared expenses accurate while moving between households, trips, and other personal groups. The browser prototype demonstrates the desired experience but does not authenticate real members, persist a shared ledger, or exercise device behavior. A native client must agree with the web app about money, membership, Tags, and running Balances, while handling interrupted connections and unfinished work without losing entries or recording them twice.

## Solution

Build an Android-first React Native app using Expo development builds and the existing SplitBook backend and shared domain rules. Deliver internal Android APKs against a separate staging ledger. Keep the shared app compatible with a later iOS release without making iOS release delivery part of this beta.

Use the reviewed Android prototype for navigation and visual direction: Outfit UI text, IBM Plex Mono amounts, paired light/dark semantic colors, clear money labels, reachable primary actions, and a trip-only itinerary header. Native screens implement the design; the prototype's local ledger is not the production financial engine.

The beta covers sign-in, personal summaries, Groups, Group creation and invite-link joining, Expenses and their supported splits, Expense edits and deletion, Balances, Settlement recording, Activity, and appearance/settings. Users can view previously loaded data offline and retain an Expense draft. Financial writes require a connection. Advanced Group administration and recurring-template management remain on the web initially.

## User Stories

1. As an Android beta tester, I want an installable app, so that I can use SplitBook without a browser tab.
2. As a beta tester, I want the app to identify its staging environment, so that I can distinguish test records from live financial data.
3. As an approved member, I want to sign in with Google, so that the app accesses my existing identity and authorized Groups.
4. As a returning member, I want my session to survive an app restart, so that I do not sign in before every expense.
5. As a member with an expired session, I want a clear sign-in recovery path, so that I can regain access without losing an eligible draft.
6. As a person outside the private-beta allowlist, I want an understandable access message, so that an invitation does not falsely promise account access.
7. As a developer, I want fictional personas in a dedicated development experience, so that I can iterate without production accounts.
8. As a beta tester, I want development persona authentication excluded from the distributed beta, so that account access remains authentic.
9. As a member, I want to sign out and clear local financial data, so that the next user of the device cannot see my cache or drafts.
10. As a member changing accounts, I want each account's state isolated, so that another account's Group data or submission cannot appear in my session.
11. As a member, I want separate totals for what I owe and what I am owed, so that a net total cannot hide obligations.
12. As a member using multiple currencies, I want currency-separated totals and explicit currency labels, so that unrelated amounts are not added together.
13. As a member, I want to choose among my Groups, so that I can enter an expense in the right shared ledger.
14. As a member, I want a prominent add-expense action, so that frequent entry is quick and reachable on a phone.
15. As a Group creator, I want to select a Theme from Trip, Household, Couple, Work, and General, so that the Group's structure fits its purpose.
16. As a Group creator, I want relevant names and date fields for the selected Theme, so that a Household is not presented as a trip that must end.
17. As a Group creator, I want to choose the Group currency and understand when it becomes fixed, so that later financial records remain consistent.
18. As a Group member, I want to share an invite link through the device's sharing interface, so that I can invite someone through my chosen channel.
19. As an invited person, I want a Group preview and an explicit join action, so that opening a link does not silently change membership.
20. As an invited person who needs to sign in, I want my invite destination retained, so that I can finish joining afterward.
21. As an invited person, I want useful invalid-link, unavailable-Group, and access-denied states, so that a failed join has a clear next step.
22. As an existing Group member, I want opening the same invite again to return to the Group, so that I am not added twice.
23. As a Trip member, I want dates and the signature itinerary header, so that the Group has an appropriate travel identity.
24. As a Household member, I want a neutral ledger header and Month selector, so that recurring household spending is easy to inspect.
25. As a Household member, I want monthly expense totals labelled separately from my running Balance, so that I do not mistake one for the other.
26. As a Household member, I want changing Month to change only the expense view and monthly breakdown, so that it cannot reset or close the ledger.
27. As a Household member, I want fronted amounts, shares, and monthly contribution differences, so that I can understand that Month's expenses without treating them as Settlement balances.
28. As a Household member, I want Months computed in my local timezone, so that expenses near midnight appear in the intended view.
29. As a Household member adding an Expense from a past Month, I want the date to default to that Month's last day, so that the entry starts in the context I selected.
30. As a Group member, I want meaningful empty, loading, unavailable, and retry states, so that missing data is not mistaken for a settled Balance.
31. As a member entering an Expense, I want amount, description, Group, payer allocation, participants, date, Category, and Tag, so that the saved entry contains the information required by the ledger.
32. As a member entering an Expense, I want an equal split by default, so that the common case requires little setup.
33. As a member with an uneven Expense, I want the supported unequal, exact, percentage, and shares methods, so that mobile can represent the same allocations as the web app.
34. As a member whose Expense has multiple payers, I want to inspect and preserve their allocations, so that editing on mobile does not discard who paid.
35. As a member entering an Expense, I want the resulting participant shares before saving, so that I can check the allocation.
36. As a member, I want currency-appropriate precision and exact total conservation, so that splitting cannot create or lose a minor unit.
37. As a member selecting a Tag, I want its stable identity preserved through renames, so that my Expense remains correctly classified.
38. As a member editing an old Expense, I want an attached archived Tag retained when valid, so that unrelated corrections do not require rewriting history.
39. As a member entering invalid values, I want specific correction messages and retained input, so that I can fix the Expense without starting over.
40. As a member saving an Expense, I want visible saving and success states, so that I know whether the ledger accepted it.
41. As a member after a save succeeds, I want the Expense list, monthly summary, running Balance, and Activity to refresh consistently, so that the views agree.
42. As a member interrupted during entry, I want one Expense draft per Group and account to survive app restarts, so that I can continue later.
43. As a member opening another Expense while a draft exists in that Group, I want to resume or explicitly replace it, so that the app does not silently discard my work.
44. As an offline member, I want previously loaded data labelled as offline and potentially stale, so that I do not mistake it for a current ledger read.
45. As an offline member, I want to continue preparing a draft while financial saves remain unavailable, so that I can work without an automatic future write.
46. As a member whose create response was lost, I want to resolve or retry the same attempted submission, so that one action creates one Expense or Settlement.
47. As a member restarting after an uncertain submission, I want that uncertainty retained, so that the app cannot treat it as a fresh unrelated action.
48. As a member editing an Expense, I want the latest saved values and existing access rules respected, so that mobile edits are consistent with web edits.
49. As a member whose Expense was changed elsewhere, I want my draft preserved beside the latest saved record for review, so that I can consciously reapply changes.
50. As a member deleting an Expense, I want to review the deletion and see the resulting ledger change, so that an accidental tap cannot quietly alter balances.
51. As a member after an edit or deletion response is lost, I want the current record checked before another mutation, so that retry does not blindly overwrite a newer change.
52. As a member whose access was removed, I want stale cached actions disabled and authoritative access checks honored, so that cached membership cannot authorize a write.
53. As a member inspecting Balances, I want names, direction, amount, and currency for each debt, so that I know who owes whom.
54. As a member recording a Settlement, I want the suggested debt as a starting amount, so that the common full-payment case is quick.
55. As a member who already made a partial payment, I want to record that actual amount, so that the remaining Balance stays accurate.
56. As a member recording more than the latest suggested debt, I want an explicit warning and acknowledgment, so that an overpayment is deliberate.
57. As a member reviewing a Settlement, I want the payer, recipient, currency, and actual paid amount confirmed before recording, so that the ledger reflects the intended payment.
58. As a member, I want Settlement copy to explain that no money is transferred and no Month is closed, so that recording does not imply payment processing.
59. As a member after recording a Settlement, I want confirmation and updated Balances and Activity, so that I can verify its effect once.
60. As a member viewing Activity, I want the backend's authorized financial history, so that another client's changes appear in the same Group story.
61. As a member, I want light and dark appearance preferences, so that every screen and sheet remains comfortable and readable.
62. As a member using large text or assistive technology, I want readable amounts, labelled controls, clear focus, and accessible touch targets, so that core financial tasks remain usable.
63. As an Android user, I want correct back, keyboard, and interruption behavior, so that navigation or typing does not hide actions or silently lose a draft.
64. As a beta operator, I want a repeatable staging build and verification procedure, so that installing and reviewing the app does not require a production migration.

## Implementation Decisions

- React Native and Expo development builds are accepted. Android is the first delivery target; retain cross-platform boundaries for later iOS delivery. Public app-store publication and a paid cloud-build subscription are separate decisions.
- Follow the existing monorepo, shared-domain, and Better Auth ADRs. The current web backend remains authoritative for authorization and ledger mutations. Native screens consume shared pure TypeScript rules and validated API contracts; they do not import web UI or database modules.
- Follow the reviewed prototype's navigation and paired semantic visual system. Adapt Android back behavior, keyboard-aware entry, short selection sheets, large text, and touch targets rather than embedding the browser prototype as the app.
- Group Theme changes structure, copy, and date semantics, not the financial palette. Trip itinerary chrome is Trip-only. Month is a viewer-timezone expense filter; Balances and Settlements remain all-time and separated by currency.
- Build the connected beta around existing authorized API reads and writes. Preserve the private-beta allowlist; a Group invitation does not grant sign-in eligibility. Native authentication work reuses the existing mobile-readiness ticket and owner-managed Google OAuth setup ticket instead of recreating them.
- Use Better Auth's native/Expo integration with protected session storage, appropriately trusted app origins, callback handling, and authenticated ordinary API requests. Keep developer persona authentication in explicitly development-only builds and permitted development backends; exclude it from the staging beta and production experience.
- Keep one native data-access boundary for session-bearing requests, JSON date normalization, currency-aware response types, cache ownership, refresh, and safe recovery. Use wire-accurate DTOs for timestamp strings and currency-separated balances rather than treating serialized dates as live Date objects.
- Preserve response compatibility for the web client when adding stable machine-readable error identifiers needed to distinguish stale revisions, conflicting create retries, locked currency, access failures, and validation. Native recovery must not branch on human error text.
- Reuse current shared currency precision, exact money allocation, split validation, and Tag identity rules. Payer and participant totals must equal the Expense amount. Native entry and editing preserve all existing supported split methods and payer allocations, with advanced controls progressively disclosed.
- A Group's configured currency governs new financial entries, including its established currency-lock rules. Home and legacy multi-currency reads retain explicit currency separation. No foreign-exchange conversion or cross-currency net total is introduced.
- Group creation and invite-link joining are in the beta. Sharing presents the device share interface for the user to choose a destination; the app does not claim to send email invitations. Preserve the pending join destination across cold start and authentication. Give web fallback when the app is not installed, and test actual link opening in the installed staging build.
- Validate invitation and administration destinations against the build's configured environment. A staging APK must not silently follow a production invite or use production authentication/storage. Keep account and environment ownership in persistent cache and draft keys.
- Group creation and invite-link generation do not currently share financial-create idempotency. Disable blanket mutation retries. After an uncertain Group-create response, refresh the authorized Group list and prompt the user to check for the created Group before initiating another create; do not promise exactly-once behavior for every mutation.
- Initial Expense scope includes creation, detail, authorized editing, and deletion under existing backend semantics. Preserve the audit trail and established soft-delete behavior. Dedicated restore/history-management UI is not added by this spec; existing web administration remains available.
- Advanced Group administration, Tag administration, member administration, and recurring-template management remain web capabilities. Existing recurring-generated Expenses remain visible and obey ordinary authorized Expense behavior on mobile.
- Persist one Expense draft per Group and signed-in account, with create/edit identity and the originally read revision where relevant. Explicitly offer resume or discard/replace when opening a competing draft; do not silently overwrite it. Validate restored members, Tags, currency, permissions, and revisions before saving.
- Persist caches and drafts in account-isolated device storage, keep sessions in protected storage, and avoid logging financial payloads or authentication secrets. On explicit sign-out or account change, purge local financial data and attempted submissions and prevent in-flight old-account results from repopulating the next account's state. Expired-session recovery must not expose the prior account's content to a different sign-in.
- Offline views carry clear stale/offline labels and previously loaded values. An offline launch without cached data shows an unavailable state. Draft editing may continue, but there is no automatic offline create, edit, delete, join, or Settlement queue. A network indicator does not prove that a write will succeed; all requests retain normal failure handling.
- For Expense and Settlement creates, persist an immutable attempted payload and retry identity before sending, separately from the editable draft. Repeating an uncertain submission uses the same payload and identity. Block turning an unresolved attempt into a modified new submission until its result has been reconciled. Successful resolution refreshes dependent views and clears the completed attempt.
- Do not automatically resubmit a financial write merely because connectivity returns or the app opens. The user resolves the pending attempt explicitly. If a user signs out while an attempt is uncertain, explain that local recovery data will be cleared and that saved history must be checked after signing back in before recreating the entry.
- For Expense edits and deletion, use the backend's existing record-revision precondition. On conflict, preserve the user's draft, fetch the latest saved record, and require explicit review before applying a new update. Do not automatically merge financial fields or silently replace the original revision.
- A lost edit/delete response is reconciled by reading the current authorized record, including its deleted state where the backend supports it. Record-revision preconditions protect against stale writes but do not themselves make edit/delete replay equivalent to create-request idempotency.
- Settlement recording documents an actual payment already made. Refresh the suggested debt when entering review, default the amount to that suggestion, allow positive currency-valid partial or full actual amounts, and require a separate acknowledgment when the entered amount exceeds the latest available suggestion. Review retains the selected payer, recipient, currency, and amount. Server authorization and membership remain authoritative.
- The current backend has no Group-balance revision that freezes a suggested debt between review and recording. Do not promise atomic debt matching or automatically change the actual paid amount after a refresh. Concurrent ledger activity can change the resulting Balance; success shows the refreshed result rather than promising the Group is fully settled.
- Deliver internal Android APKs using a separate staging backend and ledger. Begin with fictional seed data and separately authorized beta accounts. Backend configuration, auth origin/callback settings, signing setup, and ledger migration/index prerequisites must be validated for staging. Existing production data, production migration, and production deployment remain outside this spec.
- The working tree already contains substantial uncommitted ledger-hardening implementation. Reuse it through a reviewed integration baseline; a checkout from current committed history alone does not include that work. Do not sweep unrelated edits into mobile commits or recreate the same money/retry backend. Tracker-open work is not evidence of deployment, and local QA reports are not a substitute for validating the integrated mobile baseline.

## Testing Decisions

Proposed for user confirmation before publication:

- The primary new acceptance boundary is an Android user journey through the native app, real HTTP backend, and disposable test database. Assert user-visible outcomes and subsequent authorized reads: sign in, join/open a Group, add and split an Expense, interrupt/retry, observe exactly one record and correct Balances, then record a Settlement and verify its once-only effect.
- Reuse the existing authenticated HTTP request harness for backend money, membership, Tag identity, idempotency, and record-revision invariants. Extend those tests only for changed contracts such as additive error identifiers and native session transport. Retain existing pure shared money and split tests rather than duplicating them in every screen package.
- Add native journey coverage for session persistence, callback and invite resumption, back/keyboard behavior, light/dark screens, large text, offline cached views, restart-persistent drafts, account changes, and network failures. Use controllable transport interruption at the native data-access boundary while keeping backend persistence real.
- Test response loss after the server committed an Expense or Settlement, followed by app termination and explicit retry. Verify one saved record, one financial effect, and eventual authorized Activity. Separately test a definite validation failure, an edited draft, and a new intentional submission.
- Test stale Expense edits from a second client, a lost edit/delete response, membership removal, a renamed or archived Tag, a competing Group draft, a session expiry, and sign-out while requests remain in flight. Assert preserved drafts where allowed, explicit review, no silent overwrites, and no account data leakage.
- Test current, past, empty, and all-time Household expense views with timezone-boundary fixtures. A Month change must leave running Balances and Settlement scope unchanged. Check per-currency home totals and the Trip-only itinerary header.
- Test partial Settlement amounts, amounts above the suggested debt, changing debts before review, cancellation, and retries. The recorded actual amount stays the reviewed amount; refreshed balances and history establish the result.
- In automation, substitute Google only at the external provider-verification boundary using the existing guarded test mechanism. Separately smoke-test real Google sign-in, callback return, protected session persistence, and invite opening in an installed Android development/staging build. Mock-provider success alone cannot satisfy the real sign-in release gate.
- Each vertical ticket carries its own acceptance tests. Before beta delivery, run relevant workspace lint/type checks, shared and backend regression suites, native journey checks, a staging build/install check, and visual/accessibility review of core flows on an Android device or emulator. Keep staging and test databases isolated from production.

## Out of Scope

- iOS release delivery, public Play Store publication, live-data cutover, production migration or deployment, and paid build-service commitments.
- A standalone demo as the release product, production demo authentication, a new backend, new database engine, or replacement auth provider.
- Automatic offline financial synchronization, automatic money-field merges, and background financial write retries without user review.
- Payment processing, bank transfers, FX conversion, budgets, receipt capture, push notifications, and actual email delivery.
- Dedicated native recurring-template management, advanced Group/member/Tag administration, and a new Expense restore/history-management surface.
- Atomic Group-debt snapshot enforcement, a new event-sourced ledger, or reimplementation of already approved ledger-hardening work.
- Copying web UI components or the prototype's mock financial engine into native production behavior.

## Further Notes

- Accepted decisions: React Native; Expo development builds; Android first; connected beta; offline cache/drafts with online writes; core daily mobile flows; partial actual-payment recording with over-suggestion warning; account-scoped restart-persistent Expense drafts; explicit stale-edit review; internal staging APKs.
- The current glossary distinguishes Theme, Category, Tag, Month, Balance, Settlement, and Expense draft. In particular, Theme describes a Group; Category classifies an Expense. An Expense draft has no ledger effect.
- Existing prerequisites: [Mobile readiness](https://github.com/FireBird1998/splitbook/issues/36), [platform Google OAuth clients](https://github.com/FireBird1998/splitbook/issues/35), and [ledger-hardening specification](https://github.com/FireBird1998/splitbook/issues/39) with its existing implementation tickets. Preserve their scope and status; new mobile tickets reference them instead of silently marking them complete.
- [Production Better Auth cutover](https://github.com/FireBird1998/splitbook/issues/33) remains separate from staging verification and is not declared complete by this mobile work.
- The reviewed OpenDesign prototype supplies the UX reference. Its simulated interactions and reported assertions do not replace native device and integrated backend acceptance.
- The final testing boundary and ticket granularity/blocking graph await the user's review. Once confirmed, publish this specification and approved tickets to the configured GitHub tracker with the ready-for-agent label. Implementation begins from tickets whose real prerequisites are satisfied.
