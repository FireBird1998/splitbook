# Splitbook internal MUI design system — v1 specification

**Date:** 2026-09-06  
**Status:** Product decisions accepted; specification complete for implementation planning. No application implementation or rollout performed.  
**Decision record:** [Q1–Q10 and audit evidence](../../design-system/decision-log.md)  
**Baseline:** Canonical Splitbook `main`, commit `9aea66f`. Recheck the checkout before implementation; do not build from the unrelated OCR branch.

## 1. Problem and intended outcome

Splitbook already has semantic colors, a MUI theme, light/dark support, branded
fonts, and several reusable UI modules. It lacks a complete contract connecting
those foundations to everyday screen development: repeated styling decisions,
inconsistent feedback states, competing token authorities, and screenshots that
are saved without regression comparison.

The outcome is a small internal design system that makes the right presentation
easy to reuse, documents it with live examples, and detects unintended changes.
Version 1 is complete when the foundations, local catalogue, Dashboard, and group
Balances pilot meet this specification and the owner has reviewed the evidence.
It does not mean the entire application has been migrated.

## 2. Accepted scope and invariants

- Keep MUI v7, Emotion, and the existing React/Next.js stack. No major upgrade or
  replacement styling framework is part of this work.
- Preserve Travel Ledger structure + Calm Finance restraint: indigo brand, sky
  information, coral owed, mint settled/owed-to-you, Outfit UI text, IBM Plex Mono
  money, and the trip strip. Adjust shades when needed for accessibility.
- Treat light and dark as paired deliverables, not sequential projects.
- Build inside Splitbook. No public package, package publishing, separate product,
  paid design tooling, or paid visual-review service is required.
- Preserve all calculations, rounding, currency separation, permissions, data
  contracts, refresh behavior, invitations, and existing user journeys.
- Preserve Google OAuth, the invite-only access policy, and demo-auth production
  safeguards. This initiative does not fix or reconfigure OAuth credentials.
- Follow [domain language](../../../CONTEXT.md): a group **Theme** is its product
  identity, stored in `Group.category`; **Category** classifies expenses. A visual
  theme means the MUI presentation. A Household **Month** remains a reporting lens,
  never a change to balances or the ledger.

### User outcomes

1. Members can read amounts and statuses clearly in either visual mode.
2. Mobile and keyboard users can reach actions and understand feedback.
3. Members see consistent loading, empty, partial-failure, and error states without
   losing existing recovery actions or useful data.
4. Contributors can find a working example of a supported pattern without logging
   in, connecting a database, or supplying private information.
5. Contributors know when to use MUI defaults, a shared module, or local layout.
6. The owner can inspect a small pilot before broader conversion and review
   intentional visual changes against a reproducible baseline.

## 3. Foundation contracts

### 3.1 Authority and token semantics

The runtime TypeScript theme is the sole authority. Preserve the prototype files
as historical reference and update their documentation and the runtime header to
state that they are not a second editable production specification. Do not delete
the prototypes or introduce a token generator in v1.

| Foundation       | Required contract                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color            | Roles have matching light/dark keys. Keep decorative accent, readable foreground, and tinted background distinct when one value cannot serve all three safely.                                                        |
| Status           | Provide intentional text-on-tint combinations for positive, negative, warning, and information. Include readable amounts on normal surfaces, not only chips. Meaning must also appear in text or accessible labels.   |
| Typography       | Retain the fonts and existing MUI variants. Document their role and hierarchy. Use semantic HTML headings independently of visual text size.                                                                          |
| Money            | `MoneyText` remains the display interface. Retain currency, sign, tone override, formatting, and zero behavior. Typography improvements must not change arithmetic or display precision.                              |
| Spacing          | Use the existing MUI spacing scale; document common page, section, and control gaps. Do not invent a parallel pixel scale.                                                                                            |
| Shape            | Retain the existing small/medium/large radii. Map each intentional use through shared defaults.                                                                                                                       |
| Layout           | Consolidate repeated navigation height/sidebar width. Preserve the existing MUI breakpoint scale and desktop navigation threshold. Replace isolated breakpoint literals only after reviewing their intended behavior. |
| Focus and motion | Keep visible focus treatment and reduced-motion support. Adopted interactive states must remain distinguishable and usable.                                                                                           |

The implementer selects exact accessible color values using measurements and the
pilot review, then records them in runtime tokens; there is no requirement to keep
an inaccessible foreground value unchanged. Do not use the disabled-text token
as ordinary low-emphasis content if it fails the required contrast.

Remove unsupported palette references such as `error.lighter` with the closest
supported semantic role. This narrow correction is allowed in an otherwise
deferred screen; it does not expand v1 into a full Expense-form migration.

### 3.2 MUI defaults before new modules

Use theme defaults, overrides, and variants for recurring visual treatment of
existing MUI controls. Retain existing behavior such as disabled controls, focus,
dialog escape handling, and responsive sizing. Type any new custom variants at
both the theme definition and consumer interface.

Keep `sx` for local arrangement, responsive composition, and documented exceptions.
Do not set a target for reducing its occurrence count. Repeated semantic colors,
money presentation, and status rules belong in shared definitions.

This uses the customization mechanisms documented for the installed major version.
[MUI v7 themed components](https://v7.mui.com/material-ui/customization/theme-components/).

## 4. Shared UI modules and interfaces

The shared presentation seam is the rendered module's props and observable UI.
Modules consume presentation data and optional user-action callbacks; they do not
fetch data, own sessions, infer permissions, or write to the ledger. Existing
screen controllers retain those responsibilities. Tests use the same interface
as screen callers.

| Module / pattern            | Interface and responsibility                                                                                                                       | v1 treatment                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `MoneyText`                 | Amount, currency, sign/tone options and existing typography props; renders existing formatting with consistent readable money treatment.           | Preserve and test.                                                                       |
| `TripStrip` / `GroupHeader` | Existing trip or non-trip presentation inputs.                                                                                                     | Preserve interfaces; include theme/layout regression coverage when affected.             |
| Section container           | Content plus optional heading/action; consistent surface, padding, heading association, and responsive header layout. No mandatory nested heading. | Extract only where pilot callers share these rules; otherwise use a MUI variant.         |
| Status label                | Semantic tone and a required readable label; optional decorative icon. No automatic live announcement or click behavior.                           | Share the pilot's repeated status treatment.                                             |
| Empty state                 | Heading/body and optional existing action; neutral explanation, distinct from failure and loading.                                                 | Share repeated pilot composition when justified.                                         |
| Error state                 | Safe message, error/warning severity and optional recovery action; accessible announcement appropriate to the failure.                             | Share repeated pilot behavior without exposing raw server details or duplicating alerts. |
| Loading state               | Existing content-shaped MUI skeletons and an accessible loading indication.                                                                        | Standardize usage; do not require one generic skeleton for every screen.                 |

Names for new modules are implementation details. A module must pass the deletion
test: removing it would force repeated rules or behavior back into callers. Do not
create a wrapper solely to rename a MUI element, or expose every possible future
styling option. Shared confirmation-dialog work is deferred unless the pilot
reveals a concrete need; existing dialogs must continue functioning.

## 5. Local component catalogue

Provide a same-app development route at `/dev/design-system`, normally reached
through the existing local server on port 4127. It imports the actual runtime
theme and shared presentation modules, not copied HTML/CSS mockups.

Required content:

- Light/dark switching, semantic color pairs, typography, money, spacing, and shape.
- Buttons, icon actions, inputs, panels, status labels, and the v1 shared patterns.
- Default, focus, disabled, loading, empty, success, and failure examples where
  applicable, with concise usage and misuse guidance.
- Synthetic examples for long names, large/negative/zero amounts, and currencies
  already supported by existing formatters. Do not invent new formatting rules.
- Narrow and wide arrangements; the lab supplements actual viewport tests.
- Controls operate only on in-memory fixture state. Reload restores fixtures.

### Isolation and production protection

The lab must render without an OAuth configuration, MongoDB connection, user
session, or private receipts. Do not import data-fetching screens merely to display
their states; use their shared presentation modules with fixture props.

The current root layout wraps every route in `AuthProvider`. Isolate the lab from
that provider and any protected layout using URL-preserving route organization,
while retaining auth providers and checks for every existing route that needs
them. Keep common visual providers shared. This is provider organization, not a
new authentication bypass; app and API authorization must remain unchanged.

Gate the lab on the server before rendering its content. In production, including
preview deployments, the route must serve the application's not-found behavior
and expose no catalogue content. A client-only check or hidden navigation link is
insufficient. Do not add a production-enable flag. Test a direct request and client
navigation; hiding the route must not depend on the user's authentication state.

Use a separate development-server Playwright configuration for catalogue tests:
no database-seeding global setup, no OAuth/session requests, and fail on unexpected
application API requests. Use a reserved test port and reject port conflicts instead
of attaching to an arbitrary existing server. Existing app E2E configuration and
production-build checks remain separate; never enable the lab to make production
E2E tests pass.

## 6. Pilot screen requirements

### Dashboard

- Adopt approved money, section, status, and feedback presentation where applicable.
- Preserve currency buckets, invitations, next-action selection, links, refreshes,
  and the existing relationship between groups and displayed amounts.
- Test loaded content, all-empty data, initial loading, individual section failure,
  and existing recovery actions. A failed section must not turn into a misleading
  zero balance or hide other successfully loaded content.

### Group Balances

- Preserve owe/owed direction, settlement eligibility, settlement history, mixed-
  currency warning, and the existing settlement flow.
- Cover owing, owed-to-you, settled, initial loading, balance-fetch failure, and
  settlement-history failure with otherwise valid balance data.
- Retain group Theme-specific presentation and existing Month semantics. The
  design-system migration cannot reinterpret a ledger balance as monthly spending.

### Responsive and accessibility requirements

- Review both screens at the existing 390×844 mobile and 1280×800 desktop sizes in
  light and dark, plus layout checks at 320px and around navigation breakpoints.
- No unintended horizontal page scrolling, clipped amounts, hidden actions, or
  overlapping navigation. Long text must wrap or have an accessible way to reveal it.
- Meet AA text-contrast thresholds on adopted surfaces: generally 4.5:1 for normal
  text and 3:1 for qualifying large text, respecting the criterion's exceptions.
  Test foreground/background combinations actually used. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Check tab order, visible focus, labels, dialog focus entry/return, keyboard
  operation, error announcements, and reduced motion. Preserve generous existing
  touch targets; compact controls must remain comfortably operable.
- Block serious and critical axe findings on the catalogue and pilot surfaces.
  Report and track other findings. Automated checks alone do not establish full
  WCAG conformance; review keyboard behavior and rendered states manually too.

Global theme changes require smoke coverage beyond the pilot: sign-in/personas,
group navigation, TripStrip/non-trip header, expense dialog, settlement dialog,
and Settings/Recurring. Fix regressions introduced by shared changes; log unrelated
legacy issues instead of silently widening the conversion.

## 7. Verification and enforcement

### Test seams

1. **Runtime theme:** Extend the existing token tests to cover paired keys, required
   values, intended status contrast pairs, and successful construction of both
   themes. Assert contracts, not a snapshot of the entire MUI object.
2. **Rendered UI:** Exercise shared module interfaces through catalogue browser
   tests for meaningful content, roles, interactions, and supported states.
3. **Pilot routes:** Use deterministic visual fixtures and existing browser
   navigation seams; retain separate seeded demo journeys for real auth, data,
   permissions, and settlement behavior. Mocked visual fixtures do not replace
   functional integration evidence.
4. **Production lab exclusion:** Request the lab on a production build and verify
   no lab UI or fixture payload renders; existing sign-in and protected routes
   must retain their previous behavior after provider organization.

### Visual regression policy

Use `toHaveScreenshot` comparisons, not only screenshot files. Maintain at least
eight loaded pilot baselines: two screens × two sizes × two modes, plus focused
catalogue/status/feedback cases. Assertions on text and interactions accompany
images. [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots).

Stabilize dates, locale/timezone, data, fonts, motion, browser version, OS, viewport,
and device scale. Keep visual fixtures isolated from mutable settlement journeys;
do not assume shared demo balances remain unchanged between tests. Capture failure
diffs. Run baseline generation and comparisons in the same documented environment.

Do not mask money, status text, or the primary action to make a comparison pass.
Use tightly justified tolerances, not a broad threshold that conceals layout
changes. Baseline updates are reviewed with an explanation; CI must not auto-accept
them. The owner reviews initial pilot evidence before broader migration.

### Styling checks

Apply checks initially to the theme, shared v1 modules, and migrated pilot files.
Expand the explicit adoption list as subsequent screens migrate.

- Reject raw hex/RGB/HSL style colors outside token definitions or narrowly
  documented exceptions. Do not flag currency strings or user content as colors.
- Check static semantic token references against supported theme keys; type new
  module interfaces. Document limits for dynamic `sx` expressions and cover them
  with theme/render tests rather than claiming perfect static validation.
- Exceptions need a reason, scope, owner, and removal condition; an existing
  unexplained exception is not a precedent for new code.
- Exercise checks with valid/invalid fixtures, including the `error.lighter` case.
- Keep formatting, lint, typecheck, unit, integration, build, and existing journey
  checks. Record environmental failures separately from code failures. Never mark
  a check passed because it was skipped or its data dependency was unavailable.

## 8. Delivery sequence and review gate

| Step                                             | Deliverable                                                                                                                                                       | Exit evidence                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| M1a — Baseline and foundations                   | Record current visual/functional baseline; establish runtime authority; consolidate required tokens/defaults; fix invalid token usage and adopted contrast pairs. | Both-mode theme tests, documented pair measurements, baseline captures, shared-theme smoke results.                              |
| M1b — Shared patterns and lab                    | Implement only justified shared modules and catalogue; isolate auth dependencies and protect production.                                                          | Catalogue works without credentials/database, module-state checks pass, production exclusion and auth-regression tests pass.     |
| M1c — Real-screen pilot                          | Migrate Dashboard and Balances; add comparison baselines and scoped styling/a11y gates.                                                                           | Functional journeys preserved; all pilot modes/sizes and failure states verified; owner receives reviewed before/after evidence. |
| Review gate                                      | Owner approves the pilot and notable visual changes.                                                                                                              | Explicit approval recorded before broader migration. Until then, v1 is implemented but not accepted.                             |
| Later — Expenses                                 | Expense list/cards/forms and relevant confirmations.                                                                                                              | Separate scoped follow-up using the proven contracts.                                                                            |
| Later — Settings/Recurring and remaining screens | Continue adoption incrementally.                                                                                                                                  | Update adoption list and relevant tests with each migration; do not claim completion from the pilot alone.                       |

Keep implementation changes independently reviewable. Update `docs/ui.md` only
when the described behavior actually lands. Documentation, catalogue examples,
and tests change alongside their modules; leave unrelated historical plans intact.

### Rollback and scope control

Separate foundation and screen migrations into small changes. Before each shared
change, record affected surfaces and before-state evidence. If a regression cannot
be resolved within scope, revert the affected change and dependent changes together
so theme consumers stay compatible. No database rollback, reset, destructive Git
cleanup, or authentication change is needed for a presentation rollback.

Do not deploy, publish issues/packages, or modify remote infrastructure merely
because this specification exists. Those actions follow the user's implementation
and release instructions separately.

## 9. Acceptance checklist

- [ ] AC1: Runtime TypeScript is authoritative; historical prototype guidance no longer conflicts.
- [ ] AC2: Existing brand, money semantics, paired modes, and product behavior are preserved.
- [ ] AC3: Required token pairs are measured; invalid adopted references fail focused checks.
- [ ] AC4: Shared modules expose small presentation interfaces with tested observable behavior.
- [ ] AC5: The catalogue works without MongoDB/OAuth/private data and makes no application API requests.
- [ ] AC6: The lab is unavailable in production; existing auth/access behavior still passes regression checks.
- [ ] AC7: Dashboard and Balances pass loaded, empty, loading, and relevant partial/full-failure scenarios.
- [ ] AC8: The eight loaded pilot visual baselines and focused state comparisons pass reproducibly.
- [ ] AC9: Adopted surfaces have no serious/critical axe findings and pass manual keyboard, contrast, responsive, and reduced-motion review.
- [ ] AC10: Global-theme smoke coverage and existing functional tests show no introduced regression.
- [ ] AC11: Usage guidance, adoption scope, exception rules, and baseline-review instructions are documented.
- [ ] AC12: The owner has approved the pilot evidence before any wider screen conversion.

Acceptance boxes remain unchecked until implementation supplies the evidence.

## 10. Deferred and out of scope

- Public design-system package, OSS publication, Storybook adoption, paid services,
  a design-token generator, or a whole-app rewrite.
- A new visual identity, new feature workflows, currency/ledger changes, database
  migrations, OCR integration, private screenshot handling, or production cutover.
- OAuth credential repair, changing the invite-only policy, or weakening demo
  safeguards to facilitate catalogue development.
- Full accessibility certification or claiming all legacy screens meet the pilot's
  quality bar. Track known legacy gaps with an owner and a follow-up milestone.
- New system-wide primitives without proven callers or interfaces for hypothetical
  downstream applications.

There are no unresolved product questions for v1. Exact token values, small module
names, and focused test tolerances are implementation choices constrained by this
specification and the owner review gate, not reasons to reopen the entire interview.
