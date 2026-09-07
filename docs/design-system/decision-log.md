# Splitbook MUI design system — decision log

Date: 2026-09-06  
Status: Interview complete; Q1–Q10 accepted. Documentation only; implementation has not started.  
Baseline: canonical Splitbook `main`, commit `9aea66f`.

## Goal

Turn the existing MUI theme into a documented, reusable, tested internal design
system without redesigning Splitbook or changing expense calculations, data,
authentication, permissions, or deployment infrastructure.

This document records the grilling conversation. The user accepted the second
round's recommendations on 2026-09-06, resolving all remaining product decisions.
The resulting [implementation specification](../superpowers/specs/2026-09-06-mui-design-system.md)
defines the deliverables and acceptance checks.
Existing implementation plans and `docs/ui.md` remain unchanged during planning.

## Confirmed decisions — round 1

The user accepted the recommendations for Q1–Q5.

| Question             | Decision                                                   | Consequence                                                                                                                                    |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 — Audience        | Build an internal Splitbook design system first.           | No standalone package, publishing workflow, or open-source release in this initiative. Keep boundaries sensible for possible later extraction. |
| Q2 — Visual identity | Preserve Travel Ledger structure + Calm Finance restraint. | Retain indigo/sky/coral/mint roles, Outfit UI text, IBM Plex Mono money, light and dark modes, and the signature trip strip.                   |
| Q3 — Foundation      | Keep MUI v7 and add a small semantic component layer.      | No UI-library replacement or MUI major upgrade. Do not wrap every MUI component.                                                               |
| Q4 — Migration       | Adopt incrementally.                                       | Foundations, reusable patterns, a pilot, then further screens; no whole-app rewrite.                                                           |
| Q5 — Behavior        | Preserve product behavior and data flows.                  | Consistency, accessibility, and responsive improvements are allowed; changes to business rules or workflows require separate scope.            |

## What exists today

These are repository observations, not a claim that a full browser accessibility
audit or new test run has been completed.

| Area                        | Evidence                                                                                                                                                                                                                                      | Implication                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Styling foundation          | [Package manifest](../../apps/web/package.json) declares MUI `^7.3.7`, Emotion, React, and Next.js. [UI guide](../ui.md) documents MUI as the styling system.                                                                                 | Build on the existing stack.                                                                           |
| Semantic colors             | [Runtime tokens](../../apps/web/src/lib/theme/tokens.ts) define matching light/dark token shapes, with [parity tests](../../apps/web/src/lib/theme/tokens.test.ts).                                                                           | Retain this foundation; expand intentional usage contracts.                                            |
| Theme integration           | [Theme builder](../../apps/web/src/lib/theme/createAppTheme.ts) already contains MUI overrides, palette augmentation, focus, and motion styling.                                                                                              | Centralize repeated visual defaults here before creating wrappers.                                     |
| Existing patterns           | [MoneyText](../../apps/web/src/components/common/MoneyText.tsx), [TripStrip](../../apps/web/src/components/trip/TripStrip.tsx), and [GroupHeader](../../apps/web/src/components/groups/GroupHeader.tsx) already encode reusable presentation. | Evolve these instead of replacing them wholesale.                                                      |
| Competing token authorities | The runtime token file still names [prototype CSS](../design/private-beta/css/tokens.css) as its source of truth.                                                                                                                             | Decide which source future changes must update; avoid maintaining both manually.                       |
| Invalid theme usage         | [ExpenseFormDialog](../../apps/web/src/components/expenses/ExpenseFormDialog.tsx) uses `error.lighter`, which the app's palette does not define.                                                                                              | A concrete case for documented tokens and focused enforcement.                                         |
| Contrast risk               | The audit calculated approximately 3.1–3.4:1 for several light-mode status foregrounds on their matching tints.                                                                                                                               | These pairs need review where used for small text; calculations alone do not certify rendered screens. |
| Accessibility checks        | [Playwright fixtures](../../apps/web/playwright/fixtures.ts) fail on critical axe findings, while attaching other findings to reports.                                                                                                        | Serious findings can currently pass.                                                                   |
| Screenshot checks           | The same fixtures save screenshots with `page.screenshot`; they do not compare those images against approved references.                                                                                                                      | Saved screenshots are review artifacts, not visual regression protection.                              |

## Decision tree

```text
Internal MUI system + preserve identity + incremental migration [confirmed]
├── Q6: Dashboard + Balances pilot [accepted]
├── Q7: accessibility improvements with brand continuity [accepted]
├── Q8: local, synthetic-data component lab [accepted]
├── Q9: runtime token authority + incremental checks [accepted]
└── Q10: owner reviews pilot before broader migration [accepted]
    └── Final spec: contracts, acceptance checks, and migration sequence [written]
        └── Implementation is a separate next action
```

The decision frontier is empty. No further product interview is required for this
first version. Implementation details must stay within the accepted scope; scope
changes require a new decision rather than silently expanding this initiative.

## Confirmed decisions — round 2

The user accepted all five recommendations below. The questions and tradeoffs are
retained as the rationale for the final specification.

### Q6 — What must the first milestone deliver?

**Question:** Can the first milestone end with a working foundation and a small
real-screen pilot, leaving the full-screen migration for later milestones?

**Recommendation:** Deliver documented tokens and MUI defaults, shared patterns
needed by the pilot, and migrate Dashboard plus the group's Balances view. Cover
light/dark and mobile/desktop. Plan Expenses next, then Settings/Recurring.
Shared theme changes can affect other screens, so smoke-test those too; the pilot
boundary limits conversion work, not regression responsibility.

**Tradeoff:** A smaller milestone provides evidence sooner, but some older screen
patterns temporarily coexist. Do not claim the whole app is migrated.

### Q7 — How much visual adjustment is acceptable for accessibility?

**Question:** May status text shades and control spacing change when needed for
readability and keyboard/touch use, while keeping the existing brand identity?

**Recommendation:** Yes. Target WCAG AA contrast on the adopted surfaces, include
keyboard/focus checks, avoid color-only meaning, respect reduced motion, and block
serious as well as critical axe findings on those surfaces. Track remaining legacy
findings explicitly. An automated scan is not a claim of full WCAG conformance.

Normal text generally needs 4.5:1 contrast; qualifying large text needs 3:1, with
the criterion's stated exceptions. Verify the actual foreground/background pairs
used by components. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Tradeoff:** A few colors will look slightly different; preserving an exact color
value must not take priority over readable text.

### Q8 — How should we browse and learn the system?

**Question:** Is a lightweight, local component catalogue sufficient for the first
version, without introducing a separate documentation platform?

**Recommendation:** A development-only component lab using the actual theme and
components, synthetic data, both modes, responsive examples, and loading/empty/
error/disabled states. Pair it with short Markdown usage guidance. It must work
without MongoDB, OAuth, private receipts, or real user data. It must be unavailable
in production, with a test proving that boundary.

**Tradeoff:** No Storybook or paid visual-review service initially. A custom lab is
still code to maintain; reconsider dedicated tooling if contributor needs grow.
CI usage remains subject to the repository's existing plan limits.

### Q9 — What keeps the system consistent after this migration?

**Question:** Can runtime TypeScript be the sole token authority, with targeted
checks for new and migrated code rather than a blanket ban on local styling?

**Recommendation:** Make `src/lib/theme/` authoritative; retain static prototypes
as historical references, not a second editable production specification. Use MUI
defaults/variants for common styling and reusable components for repeated meaning
or behavior. Allow `sx` for local layout and documented exceptions. Add focused
checks against raw style colors and unsupported token references, without promising
that a simple lint rule can validate every dynamic `sx` expression.

MUI supports shared defaults, style overrides, and variants through its theme;
heavier customization can live in components. [MUI v7 themed components](https://v7.mui.com/material-ui/customization/theme-components/).

For adopted surfaces, compare screenshots against reviewed references using
Playwright, with stable fixtures, fonts, dates, browser, and operating-system
environment. Baseline changes require review rather than automatic acceptance.
[Playwright visual comparisons](https://playwright.dev/docs/test-snapshots).

**Tradeoff:** This is gradual enforcement, not an immediate repository-wide styling
rewrite. Reducing the number of `sx` usages is not a success metric.

### Q10 — Who approves the visual result and maintains it?

**Question:** Will you review the first milestone's visual evidence before we
continue broader adoption, and own intentional visual changes afterward?

**Recommendation:** You approve the pilot screenshots and notable visual changes.
Routine changes follow documented rules and automated checks. Anyone changing a
shared component updates its examples, relevant tests, and usage guidance in the
same change. New patterns need an actual recurring use case, not speculation.

**Tradeoff:** Visual approval is a real checkpoint, but does not require you to
review every spacing value or routine implementation detail.

## Technical direction carried into the final spec

These support the accepted decisions. They describe future work, not completed changes.

- Keep semantic colors paired across modes; give status text intentional readable
  foregrounds instead of assuming the decorative accent works for small text.
- Document existing MUI spacing and breakpoints before adding bespoke scales.
  Consolidate repeated navigation dimensions and inconsistent breakpoint values.
- Preserve money formatting and financial semantics. Do not change rounding,
  locale, currency, sign, or arithmetic behavior as part of a visual refactor.
- Keep `MoneyText`, `TripStrip`, and `GroupHeader` as existing contracts. Candidate
  additions include section containers, status labels, and empty/error states;
  include only those justified by actual pilot use. Shared confirmation dialogs
  can wait until a migrated flow needs them.
- Apply the codebase-design deletion test: a shared component is useful when
  removing it would force repeated rules or behavior back into callers. A wrapper
  that only renames a MUI element is not a goal.
- Keep the visual theme distinct from the domain's group Theme (stored in
  `Group.category`). Household and Trip remain product concepts, not separate
  competing color-token systems.
- Preserve existing functional tests and authenticated journeys. A database-free
  component lab supplements them; it does not prove auth or persistence works.

## Final specification checklist

The linked specification covers:

1. Approved scope, non-goals, and milestone boundaries.
2. Token authority and contracts for color, typography, spacing, shape, layout,
   focus, and motion in both modes.
3. The smallest justified component set, ownership boundaries, and styling rules.
4. Catalogue content and its production/privacy boundary.
5. Acceptance tests for contrast, keyboard interaction, responsive layout, component
   states, visual baselines, and unchanged product behavior.
6. Pilot rollout, review evidence, rollback approach, and later migration order.
7. Contributor checklist, exception process, and explicit deferred work.

No UI implementation, dependency upgrade, deployment, authentication repair,
database change, or receipt-OCR change is authorized by this document.
