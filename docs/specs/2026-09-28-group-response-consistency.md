## Problem Statement

Group members use web and Android to browse the same ledger, but those clients interpret Group responses separately. Android validates and normalizes the response while web relies on casts and local assumptions. Invalid required data can therefore fail inconsistently, and future response changes can drift across clients. Members must not see an incomplete list presented as complete or an invalid response presented as an empty account.

## Solution

Use one pure shared Group read module with web and Android adapters. Both clients retain their existing presentation models and read the same identities, Theme, currencies, members, dates and Tags consistently. Known optional omissions remain compatible. Invalid required data produces a visible loading error with Retry for the whole response, with no silent filtering or fabricated values.

## User Stories

1. As a Group member, I want to see the same Groups on web and Android, so that switching devices does not change my view of membership.
2. As a Group member, I want to open the same Group on either client, so that its identity and details remain consistent.
3. As a Group member, I want to see the correct Theme, so that Trip and Household experiences retain their meaning.
4. As a Group member, I want to see the original Group currency, so that amounts are not presented in an invented currency.
5. As a Group member, I want to see correctly interpreted dates, so that Group dates and ordering remain reliable.
6. As a Group member, I want to see correct member identities and roles, so that I know who participates in the Group.
7. As a Group member, I want to browse Groups with omitted optional descriptions or images, so that older valid records remain usable.
8. As a Group member, I want to browse Groups without optional trip dates, so that long-running Groups remain usable.
9. As a Group member, I want to see a visible error and Retry when required Group data is invalid, so that broken data is not mistaken for an empty account.
10. As a Group member, I want to avoid silently omitted Groups in a list, so that the displayed list does not falsely appear complete.
11. As a Group member, I want to retry a failed read after the problem is resolved, so that I can recover without restarting the app.
12. As a Group member, I want to retain appropriate previously verified data after a refresh fails, so that a temporary error does not silently erase my view.
13. As a Group member, I want to see clear stale or offline treatment where already supported, so that cached information is not misrepresented as freshly verified.
14. As a Group member, I want to receive safe error messages, so that technical payloads and personal data are not exposed.
15. As a Group member, I want to keep access to data only for my signed-in account, so that another account’s Groups are never adopted.
16. As a Group member, I want to open the Group I requested, so that a mismatched response cannot display another Group.
17. As a Group member, I want to have account-local data cleared on sign-out, so that the next account does not inherit my data.
18. As a Group administrator, I want to see existing alternate currency selections, so that settings do not silently replace historical codes.
19. As a Group administrator, I want to retain archived and retired Tag identities, so that historical Expense associations remain intact.
20. As a Group administrator, I want to view settings using complete validated Group data, so that saving settings does not lose fields omitted by a client projection.
21. As a Group member, I want to continue seeing due recurring Expenses on authorized Group reads, so that validation changes do not interfere with existing generation.
22. As a Group member, I want to continue creating and joining Groups, so that read-response work does not break existing creation or invitation flows.
23. As a Group member, I want to use an older client after harmless fields are added, so that forward-compatible responses do not unnecessarily fail.
24. As a Group member, I want to receive a clear failure for unsupported required currency or Theme data, so that the app does not silently reinterpret my Group.
25. As a Group member, I want to use accessible error and Retry states on small and large screens, so that recovery works with keyboard and assistive technology.
26. As a maintainer, I want to change Group read rules in one shared module, so that web and Android cannot drift through duplicated validation.

## Implementation Decisions

- Scope covers existing Group list/detail reads and their web list, dashboard, detail and settings consumers, plus Android list/detail consumers. Financial, invitation and authentication responses remain separate.
- The shared module validates the existing successful response envelope and all Group fields currently consumed by web. Its typed read representation retains string identities and timestamp strings. Android keeps its identity-name and Date conversions in its adapter; web need not adopt the Android screen model.
- Persistence models remain distinct from read-response models. Populated member objects do not imply full User documents. No database, framework, native or browser dependencies enter the pure shared package.
- Preserve routes, response field names, successful status codes, ordering and existing server serialization. Do not strip producer fields by serializing through a smaller consumer projection.
- Known optional omissions use documented defaults: empty description, absent optional images/dates, empty Tags and alternate currencies, and false optional flags where appropriate. Do not invent member identities or required creation/join timestamps. Missing legacy Theme may use General; a present unknown Theme follows invalid-required-data failure. This deliberately replaces web’s permissive unknown-Theme fallback with explicit failure consistent with Android validation.
- Required Group currency must be supported; never silently substitute another currency. Preserve historical alternate currency codes without applying every current write-time restriction to reads. No new read-only mode for unsupported required currencies is introduced.
- Preserve valid archived and retired Tag identities and flags. Do not filter them out as part of decoding; each existing consumer retains its relevant presentation rules.
- Additional unknown properties alone do not invalidate responses. Present known fields with invalid types do fail. Characterize optional legacy shapes before imposing defaults; do not assume lean database reads materialize current model defaults.
- Invalid required Group or populated-member data fails the entire response. No silent omission, partial-list presentation or false empty state. Error copy is safe and actionable with Retry. Failed refreshes never replace valid data with an empty list; retain existing stale/offline/account-local cache policy.
- Shape validation does not establish ownership. Preserve signed-in account checks, requested Group identity checks, authorization, logout clearing and late-response safeguards in their existing context.
- Preserve authorized detail-read recurring generation and its ordering relative to access checks. Keep creation status handling, invitation flows and settings writes compatible even where private schema reuse is practical.
- Remove duplicated Group shape validation and casts when adapters adopt the module. The result must centralize actual interpretation, not merely add shared type aliases.

## Testing Decisions

- Primary seam: existing authenticated Group HTTP reads against an isolated app and real MongoDB. Feed actual responses through both consumer adapters and assert the same Group meaning. Client journeys verify visible results and recovery; focused decoder tests cover malformed input combinations.
- Test externally observable behavior and invariants, not private helpers or structural snapshots that mirror the implementation.
- Cover optional omissions, required malformed fields, null/unpopulated members, timestamps, unsupported required Theme/currency, alternate codes, retired Tags, unknown extra fields and list ordering.
- Exercise initial-load and refresh errors, whole-list failure, Retry recovery, retained valid cache behavior, requested identity, other-account rejection, unauthorized requests and sign-out clearing.
- Preserve the existing Android DTO/controller tests and authenticated controller smoke journey, web Group browser journeys and recurring-generation integration checks. Add assertions at these seams rather than inventing another transport layer for testing.
- Verify list/dashboard/detail/settings on desktop and mobile viewport sizes, accessible error/Retry controls and relevant native behavior. Controller tests do not substitute for an actual Android UI check; report unavailable device coverage explicitly.
- Complete relevant workspace lint/type checks, formatting, shared/web/mobile tests and applicable builds. Use disposable databases and preserve the user’s local ledger and environment. Report exact tested revision and commands, results and limitations.

## Out of Scope

Financial response unification; Group creation or invitation redesign; auth changes and production Google setup; database migrations; financial writes; new offline synchronization or cache policy; new unknown-currency viewing mode; silent partial lists; global identity-field renaming; rewriting the Expense specs or implementation.

## Further Notes

This is separate from the ledger retry specification and existing Expense work under #65–70. There is no genuine implementation dependency on ledger coordination. The shared module respects the existing monorepo, pure shared-package and Android architecture decisions. Implementation must preserve concurrent user/agent work. The user approved the testing seam and six-ticket breakdown for publication. This specification does not claim implementation or new verification.
