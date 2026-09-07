# MUI design system v1 — implementation evidence

Date: 2026-09-06. Baseline: `9aea66f`. Specification: [#15](https://github.com/FireBird1998/splitbook/issues/15).

The foundations, development lab, Dashboard, and Balances pilot are implemented.
Owner visual acceptance is still pending. Expenses and Settings/Recurring have
not been broadly migrated. Nothing has been pushed or deployed by this work.

## Delivered

- Runtime TypeScript tokens are the only production authority; historical
  prototypes remain intact and are labelled as reference.
- Paired, measured status foregrounds retain the existing indigo/sky/coral/mint
  identity. Minimum measured status text contrast is 4.97:1 in light mode and
  5.10:1 in dark mode on the intended surfaces. See [all measurements](README.md).
- `MoneyText`, `StatusLabel`, `ErrorState`, and `EmptyState` provide the shared
  presentation rules. Loading remains content-shaped and screen-owned.
- `/dev/design-system` uses these real modules and synthetic local state without
  auth, database, or app API dependencies. Server-side production protection
  rejects HTML and client-navigation representations, including for signed-in users.
- Dashboard and Balances keep their existing calculations and workflows. Failed
  initial balance requests no longer label group headers “Settled”; individual
  section failures have safe recovery UI, and pending requests are not empty data.
- Scoped style enforcement, automated accessibility checks, Linux screenshot
  comparisons, and contributor guidance protect the adopted surfaces.

## Verification

All test data uses isolated local MongoDB databases. No Atlas credentials,
production OAuth settings, or production data were changed. The Google tests use
the existing local OIDC stand-in, not a live Google login.

| Check                                                  | Result                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Unit and integration suite                             | 264 passed across 37 files                                                      |
| Typecheck, ESLint, scoped formatting, diff whitespace  | Passed                                                                          |
| Design-system style policy                             | Passed; 8 adopted files including theme construction                            |
| Production build                                       | Passed                                                                          |
| Credential-free catalogue matrix                       | 20 passed; actual comparison run after initial baseline generation              |
| Production lab exclusion                               | Passed for HTML, RSC, query/trailing-slash variants and adjacent protected path |
| Google-mode journeys                                   | 6 passed, including authenticated lab exclusion and denied-identity behavior    |
| Existing demo journeys and theme smoke                 | 40 passed                                                                       |
| Expanded pilot behavior, accessibility and screenshots | 52 passed on the final production build                                         |
| Household header, Settings and Recurring smoke         | 4 passed in a focused rerun after correcting an ambiguous Add-button selector   |

The pilot checks both modes at 390×844 and 1280×800, plus reachable settlement
actions at 320/600/1199/1200px. It exercises keyboard entry, tab sequence, focus
trapping, Escape and focus return; loaded/empty/independently loading/error/retry
states; owing/owed direction; and settlement-history failures. Screenshot runs use
reduced motion, fixed dates, public response fixtures, fonts and locale.

Serious and critical axe violations block the lab and loaded pilot. Existing
journeys retain their original broader smoke checks. This is not full WCAG
certification or a claim that every legacy screen meets the adopted-surface bar.

Initial test failures were investigated rather than treated as skipped passes:
the contrast regressions and independent-loading gaps were fixed; test-harness
assumptions about a hidden Next.js announcement, initial modal focus, redirect
status, and synthetic Settings data were corrected. Docker was started locally
for the existing test database and the documented Linux browser environment.

## Visual review

These are review candidates, not owner-approved designs. Compare the screens live
as well as the images: fixed bottom controls appear in the middle of a full-page
capture at the viewport boundary. Tests also scroll the settlement action into
view and check that it is not blocked by an overlay. Only the Next.js development
overlay is excluded from comparisons; money, status and actions are not masked.

| Mode / size   | Dashboard                                                                      | Balances                                                                      |
| ------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Desktop light | [Image](../../apps/web/playwright-pilot/snapshots/desktop-light/dashboard.png) | [Image](../../apps/web/playwright-pilot/snapshots/desktop-light/balances.png) |
| Desktop dark  | [Image](../../apps/web/playwright-pilot/snapshots/desktop-dark/dashboard.png)  | [Image](../../apps/web/playwright-pilot/snapshots/desktop-dark/balances.png)  |
| Mobile light  | [Image](../../apps/web/playwright-pilot/snapshots/mobile-light/dashboard.png)  | [Image](../../apps/web/playwright-pilot/snapshots/mobile-light/balances.png)  |
| Mobile dark   | [Image](../../apps/web/playwright-pilot/snapshots/mobile-dark/dashboard.png)   | [Image](../../apps/web/playwright-pilot/snapshots/mobile-dark/balances.png)   |

Eight additional focused catalogue images cover error and recovered feedback.
Pre-change local captures remain under `output/playwright/design-system-before/`;
these native-browser seeded-data captures are qualitative references, not the
Linux comparison baselines. Dates/data can differ. The new comparisons use one
reproducible Linux browser environment documented in the contributor guide.

## Standards

Independent review of `git diff 9aea66f...HEAD` through `71168b2` against repository guidance and
the code-review smell baseline found no actionable standards violations.
The follow-up implementation commit was also reviewed cleanly.

## Spec

The initial review found two issues: theme definitions were outside style
enforcement, and independent history/invitation requests could render empty states
while loading. Both were fixed with reproducing tests. Re-review at `71168b2`
confirmed both resolved and found no remaining issues from that review.

Review summary: Standards 0 findings; Spec 2 resolved, 0 remaining.

## Owner gate and follow-ups

Open `http://localhost:4127/dev/design-system` with `pnpm dev`, then review the
pilot images above. Approve light/dark colors, money readability, narrow layouts,
and feedback before widening adoption. No acceptance checkbox or issue closure
substitutes for that approval.

The handoff preview is running on 4127 with process-only demo auth and the local
`splitbook-demo` database. Saved environment files are unchanged. Browser
verification confirmed the lab returned 200, theme switching and sample retry
worked, no application API requests occurred on the lab, and no browser errors
occurred. The separate home-to-demo-Dashboard path also passed against that
preview. The temporary Linux test-browser container has been stopped; the local
preview and MongoDB remain available.

Existing development warnings about nested-worktree root inference and the
deprecated Next.js middleware filename remain; the build succeeds. Historical
TripStrip layout details (including the signed amount wrapping in its narrow
desktop stub), scattered legacy typography/radii and non-adopted feedback are
not a broader design-system migration. Owner: Splitbook maintainer; revisit in
the next scoped visual iteration. OAuth credential repair, infrastructure cutover
and the separate OCR project remain outside this implementation.
