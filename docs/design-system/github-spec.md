## Problem Statement

Splitbook has a recognizable visual identity and a useful MUI theme, but its
screens still make repeated presentation decisions independently. Members can
encounter inconsistent feedback, weak status-text contrast, and uneven responsive
behavior. Contributors lack one authoritative set of visual rules with live,
testable examples. Existing screenshot capture does not automatically detect
visual regressions, and accessibility checks currently block only critical findings.

The owner needs an incremental, affordable way to make the interface consistent
without changing the ledger, disrupting authentication, or rewriting the app.

## Solution

Build an internal MUI design system on the current foundation. Preserve the
Travel Ledger structure and Calm Finance restraint, improve accessibility, make
runtime tokens authoritative, and introduce only shared presentation modules
that remove repeated rules or behavior.

The first version delivers the foundations, a development-only component lab,
and a Dashboard plus group Balances pilot in light/dark and mobile/desktop.
Automated behavior, accessibility, and visual comparisons protect the result.
The owner reviews the pilot before broader migration. Expenses, followed by
Settings/Recurring and remaining screens, are subsequent scoped work.

## User Stories

1. As a member, I want Splitbook to retain its recognizable visual identity, so that the improved interface still feels familiar.
2. As a member, I want equivalent light and dark presentations, so that neither mode feels incomplete.
3. As a member, I want readable status text and amounts, so that I can understand balances without straining.
4. As a member with a color-vision difference, I want status meaning expressed in words as well as color, so that I can distinguish owing, owed, and settled states.
5. As a mobile member, I want unclipped amounts, readable names, and reachable actions, so that I can use the app on a narrow screen.
6. As a keyboard user, I want logical navigation and visible focus, so that I can operate the app without a pointer.
7. As a screen-reader user, I want meaningful headings, control labels, and appropriate feedback announcements, so that I can understand and operate each view.
8. As a member who prefers reduced motion, I want nonessential animation reduced, so that the interface respects my device preference.
9. As a member, I want existing currency formatting, signs, precision, and separate currency totals preserved, so that visual improvements do not change financial meaning.
10. As a member, I want loading indicators distinct from empty data and errors, so that I do not mistake unavailable information for a zero balance.
11. As a member, I want successfully loaded sections to remain useful when another section fails, so that one failure does not hide all my information.
12. As a member, I want recovery actions to remain available after an error, so that I can retry without losing the existing workflow.
13. As a Dashboard user, I want invitations, group links, and suggested next actions preserved, so that I can continue my normal tasks.
14. As a group member, I want owe/owed direction and settlement eligibility preserved, so that the interface never suggests an incorrect payment or unauthorized action.
15. As a group member, I want settlement-history failures distinguished from balance failures, so that I know which information remains trustworthy.
16. As a group member, I want mixed-currency warnings retained, so that styling changes do not hide an existing data caveat.
17. As a Household member, I want Month to remain a reporting lens, so that the visual migration does not change what the ledger says is owed.
18. As a Trip member, I want the signature trip strip preserved, so that my group's Theme retains its identity.
19. As an invited member, I want existing sign-in and access rules preserved, so that the design-system work does not disrupt or weaken account access.
20. As a contributor, I want one runtime token authority, so that I know where a visual rule must be changed.
21. As a contributor, I want a live catalogue using real shared modules, so that examples accurately represent the application.
22. As a contributor, I want the catalogue to work without OAuth, MongoDB, or private data, so that I can develop presentation independently.
23. As a contributor, I want examples of supported states and edge cases, so that I can reuse patterns beyond the happy path.
24. As a contributor, I want small presentation interfaces, so that I can reuse behavior without learning a second general-purpose UI framework.
25. As a contributor, I want guidance on MUI defaults, shared modules, and local layout styling, so that I can make consistent decisions without unnecessary wrappers.
26. As a contributor, I want focused checks for unsupported tokens and raw style colors, so that new inconsistencies are detected early.
27. As a contributor, I want a documented exception process, so that legitimate edge cases are reviewable rather than hidden.
28. As a contributor, I want reproducible screenshot comparisons, so that unintended visual changes are visible during review.
29. As a maintainer, I want existing functional journeys retained alongside mocked visual tests, so that attractive screenshots do not conceal broken auth or data flows.
30. As a maintainer, I want the lab unavailable in production, so that internal development examples cannot become an accidental public interface.
31. As the owner, I want a small real-screen pilot before wider conversion, so that I can evaluate quality before committing to more work.
32. As the owner, I want before/after evidence for both modes and sizes, so that I can approve intentional visual changes confidently.
33. As a maintainer, I want examples, tests, and guidance updated with shared changes, so that the system remains useful after its initial release.
34. As the owner, I want to reuse existing tooling without paid services, so that the initiative stays within the current budget.
35. As a maintainer, I want reviewable and reversible presentation changes, so that regressions can be corrected without resetting data or changing infrastructure.

## Implementation Decisions

1. **Internal system, existing stack.** Retain MUI v7, Emotion, React, and Next.js. Do not introduce another styling framework, a major dependency upgrade, a separately published package, or a paid service.
2. **Preserved visual identity.** Keep indigo brand, sky information, coral owed, mint settled/owed-to-you, Outfit UI text, IBM Plex Mono money, and the trip strip. Develop both modes together. Exact shades may change to satisfy readability and the pilot review.
3. **Runtime authority.** Runtime TypeScript owns production tokens. Preserve prototype assets as historical references and correct conflicting authority claims; do not delete them or build a token generator.
4. **Semantic color contracts.** Maintain matching light/dark keys. Separate decorative accent, readable foreground, and tinted background when a single value cannot safely serve all roles. Verify amounts on ordinary surfaces as well as labels on tints. Do not use disabled-text styling for ordinary content when it fails contrast requirements.
5. **Typography, spacing, shape, and layout.** Retain existing font families, MUI variants, spacing scale, radii, and breakpoint scale. Document their intended use, consolidate repeated navigation dimensions, and review isolated breakpoint literals before changing their behavior. Semantic heading level is independent of visual size.
6. **Money presentation.** Preserve the existing MoneyText interface and formatter behavior, including amount, currency, sign, explicit tone, zero, precision, and typography options. Do not change arithmetic, rounding, currency separation, or the meaning of balances.
7. **Theme defaults first.** Use MUI defaults, overrides, and typed variants for shared visual treatment. Keep local styling for arrangement, responsive composition, and documented exceptions. Reducing the count of local styling expressions is not a success metric.
8. **Small shared modules.** Preserve MoneyText, TripStrip, and GroupHeader. Share repeated pilot status labels, section containers, empty states, and error states only where they remove repeated rules or behavior. Loading patterns may retain screen-shaped MUI skeletons. A wrapper that only renames a MUI element is not a deliverable.
9. **Presentation interface.** Shared modules receive presentation inputs and optional user-action callbacks. They do not create sessions, fetch business data, infer permissions, or write to the ledger. Existing screen controllers retain those responsibilities. Status labels require readable meaning; errors expose safe messages and appropriate announcements; empty states remain distinct from failures.
10. **Narrow invalid-token correction.** Replace unsupported palette usage, including the existing undefined error tint reference, with supported semantics. A focused correction on a deferred screen does not authorize migrating that entire screen.
11. **Component lab.** Provide a same-app development route named `/dev/design-system`, normally reached through the existing local server on port 4127. Render the actual theme and shared modules with synthetic, in-memory data. Include both modes, responsive arrangements, usage guidance, relevant interactive states, long text, and large/negative/zero amounts using existing supported formatters. Reload resets fixture state.
12. **Auth-independent lab.** Isolate the lab from the root auth provider and protected layouts using URL-preserving route organization. Preserve all providers, checks, and behavior required by existing application routes. Reuse visual providers. Do not import data-fetching screens just to demonstrate presentation; the lab must make no application API requests and require no OAuth configuration, database, session, or private receipts.
13. **Production exclusion.** Gate the lab on the server before content renders. Production and preview builds return not-found behavior without lab UI or fixture payloads, regardless of authentication state. Do not add a production-enable flag or rely on hidden navigation or a client-only check.
14. **Dashboard pilot.** Adopt the approved shared treatment while preserving currency buckets, invitations, next-action selection, navigation, refresh behavior, recovery actions, and useful partially loaded content. A failure must not masquerade as a zero balance.
15. **Balances pilot.** Preserve owe/owed direction, settlement permissions and flows, settlement history, and mixed-currency warnings. Keep balance failure distinct from settlement-history failure.
16. **Domain invariants.** A group Theme remains its product identity; Category remains an expense classification. A Household Month remains a reporting lens, never a ledger boundary or a replacement for the outstanding balance.
17. **Accessibility.** On adopted surfaces, meet AA text-contrast thresholds, generally 4.5:1 for normal text and 3:1 for qualifying large text with applicable exceptions. Support visible focus, keyboard operation, meaningful labels/headings, appropriate feedback, reduced motion, and usable touch targets. Do not express status through color alone. Automated scans do not establish full WCAG conformance.
18. **Incremental enforcement.** Scope new style checks to the theme, shared v1 modules, and migrated files, expanding the adoption list as further work lands. Reject raw style colors and unsupported static token references except narrowly documented cases. Document dynamic-expression limits and test them through rendered behavior. Exceptions require a reason, scope, owner, and removal condition.
19. **Delivery order.** First establish the baseline and foundations, then the shared modules and lab, then Dashboard and Balances with quality gates. The owner reviews the pilot before broader conversion. Expenses follows later, then Settings/Recurring and remaining screens as separately scoped work.
20. **Shared-change responsibility.** Smoke-test affected legacy surfaces after global theme changes and fix introduced regressions. Track unrelated legacy findings without silently expanding the pilot. Small, independently reviewable changes must keep theme consumers compatible when reverted.
21. **Maintenance.** Update module examples, relevant tests, and usage guidance in the same change. Update implemented-state documentation when work actually lands. Preserve historical plans and unrelated work. No schema, business API, database, OAuth credential, or infrastructure changes are required.

## Testing Decisions

1. **Primary seam: rendered behavior.** Test through existing shared presentation interfaces and browser-visible app journeys. Assert meaningful text, accessible roles, interactions, recovery behavior, and supported states. Avoid private implementation details and broad internal MUI-object snapshots. Do not create a parallel business layer solely for tests.
2. **Focused existing theme seam.** Extend existing token-parity tests to validate required paired keys, successful theme construction in both modes, and actual supported foreground/background combinations. These focused checks complement the rendered UI seam.
3. **Prior art.** Build on existing Vitest token checks, Playwright desktop/mobile and light/dark projects, axe integration, seeded demo journeys, and MoneyText behavior. Upgrade review-only screenshot capture to real comparisons on adopted surfaces.
4. **Independent lab harness.** Use a separate development-server Playwright configuration without database-seeding global setup or OAuth/session requests. Use a reserved test port, fail on conflicts, and reject unexpected application API requests. Do not attach to an arbitrary existing server. Existing app E2E and production checks remain separate.
5. **Production seam.** Directly request and navigate to the lab in a production build; verify not-found behavior and absence of catalogue content or fixture payloads. Check existing sign-in and protected-route behavior after provider organization. Never enable the lab in production to make tests pass.
6. **Shared-module states.** Cover default, focus, disabled, loading, empty, success, and failure states where meaningful. Test long text, large/negative/zero amounts, supported currency rendering, readable statuses, and action callbacks through their public presentation interface.
7. **Dashboard scenarios.** Cover loaded content, all-empty data, initial loading, independent section failures, preserved successful sections, and existing recovery actions. Preserve invitations, links, and currency separation.
8. **Balances scenarios.** Cover owing, owed-to-you, settled, loading, balance-fetch failure, settlement-history-only failure, mixed-currency warnings, and permitted settlement interactions.
9. **Visual comparisons.** Maintain at least eight loaded pilot baselines: two screens by two sizes by two modes, plus focused catalogue and feedback-state cases. Use actual comparison assertions, not only saved files, and retain text/interaction assertions alongside images.
10. **Determinism.** Stabilize fixture data, time, locale/timezone, fonts, motion, browser version, OS, viewport, and device scale. Use the existing 390×844 and 1280×800 sizes for primary baselines. Isolate visual fixtures from mutable settlement journeys, and generate and compare baselines in the same documented environment.
11. **Honest baseline review.** Capture failure diffs. Do not mask money, statuses, or primary actions, or use broad tolerances that conceal layout changes. Document any focused tolerance. Baseline updates require an explanation and review; CI cannot accept them automatically.
12. **Accessibility and responsiveness.** Block serious and critical axe findings on the lab and pilot. Record other findings. Manually verify keyboard order, focus, dialog entry/return, labels, announcements, reduced motion, and real contrast pairs. Check 320px layouts and navigation breakpoints as well as primary baseline sizes for clipping, overflow, and unreachable controls.
13. **Functional protection.** Retain real seeded demo journeys for auth, permissions, data, and settlement behavior. Mocked visual fixtures supplement, not replace, these checks. Smoke-test sign-in/personas, group navigation, trip and non-trip headers, expense/settlement dialogs, and Settings/Recurring when shared styling changes.
14. **Enforcement fixtures.** Exercise styling checks with both valid and invalid examples, including unsupported semantic token references. Exclude user content and currency strings from color-rule false positives. Document what dynamic expressions cannot be verified statically.
15. **Existing quality gates.** Retain formatting, lint, typecheck, unit, integration, build, and journey checks. Report unavailable dependencies and skipped checks honestly; environmental failures are not passing evidence.
16. **Acceptance.** V1 is accepted only when runtime authority is clear, paired-mode foundations and module contracts are verified, the lab is auth/data independent and production-excluded, both pilot screens pass their state matrix, visual comparisons and accessibility checks pass, existing behavior has no introduced regression, contributor guidance is current, and the owner approves the pilot before wider migration.

## Out of Scope

- A new visual identity, full-screen rewrite, replacement styling framework, or major library upgrade.
- Public design-system packaging or publishing, Storybook adoption, a token generator, or paid services.
- New business workflows, ledger calculations, currency conversion, schema changes, or database resets/migrations.
- OCR integration, private receipt/screenshot processing, OAuth credential repair, changes to invite-only access, or weaker demo-auth safeguards.
- Infrastructure changes or production deployment as part of specification publication.
- Full accessibility certification or a claim that all legacy screens meet the pilot's quality bar.
- Speculative shared modules and interfaces without concrete callers.
- Broad Expenses, Settings/Recurring, and remaining-screen conversion before the pilot review gate.

## Further Notes

- The owner accepted all ten design decisions across the two grilling rounds.
- Keep the first version bounded: foundations, local lab, Dashboard, and Balances. Completion of the pilot is not completion of the whole-app migration.
- Exact accessible token values, small new module names, and narrowly justified test tolerances are implementation choices constrained by these contracts and the visual review.
- Use the canonical maintained Splitbook checkout and preserve unrelated OCR work and historical plans.
- Publishing this specification creates planning material; it does not start implementation, deploy the app, purchase services, or authorize unrelated cleanup.
- The published issue uses the canonical `ready-for-agent` triage label without an additional triage round.
