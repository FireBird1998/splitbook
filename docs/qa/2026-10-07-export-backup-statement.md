# Export backup and statement verification — 7 and 8 October 2026

## Scope

The JSON backup (#318) and the printable statement with the Trip's Share wrap-up (#319), parts
of the Web portal v1 spec (#300), on branch `feat/318-319-exports`. The branch is rebased onto
main after #316 (Trip summary, PR #352) merged, so the Trip's Share wrap-up, the last open part
of #319, is built and verified here. One PR closes both issues.

| Commit                                                                                              | What it does                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Export: JSON backup and printable Group statement (#318, #319)                                      | The shared backup and statement modules, `format=json` on `GET /api/export`, the statement page and print CSS, the Export page options |
| Statement: record the Linux print baselines (#319)                                                  | The pilot's four `statement-print.png` baselines                                                                                       |
| Statement: name a whole trip's Expenses before and after its dates, as the Trip summary does (#319) | "Before the trip" and "After the trip" on a whole-trip statement, checked against `tripSummary`                                        |
| Statement: open a Trip's statement from Share wrap-up (#319)                                        | Share wrap-up on the Trip wrap-up card, and its journey                                                                                |
| Statement: refuse a Group the member can't open with the app's own page (#319)                      | The 403 refusal inside the app's shell, in the Group page's words, with Back to Home                                                   |
| docs: the JSON backup, the statement page and their browser journeys (#318, #319)                   | `docs/api.md` and `docs/testing.md`                                                                                                    |

No files under `apps/mobile` changed. The shared modules import no Next, React, MUI, Mongoose,
database or DOM code (ADR 0002).

## Changed files and purpose

| Files, relative to the repository root                                                                | Purpose                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/export-backup.ts`, `.test.ts`                                                    | One strict Zod schema and pure backup builder: exact minor units, stored currency and allocations, former people, privacy and stable ordering. |
| `packages/shared/src/export-request.ts`, `.test.ts`                                                   | `json` beside `csv`; period bounds refused for JSON, CSV unchanged.                                                                            |
| `packages/shared/src/statement.ts`, `.test.ts`                                                        | Period spending, contributions, dated Payments and current all-time balances; a whole trip's Expenses before and after its dates.              |
| `packages/shared/src/statement-request.ts`                                                            | `statementPath` and `parseStatementQuery`, framework-free.                                                                                     |
| `apps/web/src/lib/services/export.service.ts`                                                         | One authorized loader for CSV, backup and statement; the cap; the statement's Trip scope.                                                      |
| `apps/web/src/app/api/export/route.ts`, `route.integration.test.ts`                                   | JSON or CSV; schema round-trip, literal CSV bytes, access, cap, recurring switch, currencies and Trip scope against Mongo.                     |
| `apps/web/src/components/export/*`                                                                    | The Format choice, the backup's and the statement's options, reusing the Group chooser, include options and download flow.                     |
| `apps/web/src/app/(main)/groups/[id]/statement/{page.tsx,statement.css}`                              | The server-rendered statement and its A4 print rules.                                                                                          |
| `apps/web/src/components/statement/StatementView.tsx`, `.test.ts`                                     | Named sections, `MoneyText`, the currency choice, accessible tables, Print; "Before the trip" and "After the trip".                            |
| `apps/web/src/components/trip-summary/{TripWrapUpCard,TripSummaryView,TripSummaryTab}.tsx`, test      | Share wrap-up, with the viewer's zone.                                                                                                         |
| `apps/web/src/app/(main)/groups/[id]/forbidden.tsx`, `.test.ts`; `apps/web/next.config.ts`            | The real 403 (`authInterrupts`) with the app's refusal page. The bare root `app/forbidden.tsx` is gone.                                        |
| `apps/web/src/components/groups/GroupUnavailable.tsx`, `GroupDetailView.tsx`, `GroupSettingsView.tsx` | One component for a Group the member can't open, shared by the Group page, its settings and the refusal page.                                  |
| `apps/web/scripts/check-design-system.ts`                                                             | The new UI files under the design-system style policy.                                                                                         |
| `apps/web/playwright/export-backup-statement.spec.ts`                                                 | Backup download, statement from Export, Share wrap-up, refusal page; axe and review screenshots in four projects.                              |
| `apps/web/playwright-expense-access/{export,statement}.spec.ts`                                       | Production HTTP member and refusal cases, CSV and JSON, with the ledger unchanged after a denied read.                                         |
| `apps/web/playwright-pilot/statement-print.spec.ts`, four `snapshots/*/statement-print.png`           | A fictional statement's print snapshot, recorded in CI's Linux container.                                                                      |
| `docs/api.md`, `docs/export-backup.md`, `docs/testing.md`, `docs/ui.md`                               | The format, schema, period, privacy, route, access, statement and Share wrap-up.                                                               |

## Contract and behaviour

The schema's single source is `backupSchema` in `@splitbook/shared/export-backup`; `Backup` is
inferred from it, and `buildBackup` takes plain records. See
[the complete schema description](../export-backup.md).

The envelope is `format: "splitbook-backup/1"`, an ISO `exportedAt`, and every chosen Group in
one JSON attachment. Each Group has its stable id, name, Theme, currency and Trip dates, current
and referenced former people, Tags, Expenses and, when asked, Settlements. Current amounts and
allocations are exact minor-unit integers; history values keep their stored representation,
including legacy major-unit fields. No currency is converted or combined. Payers and shares are
always in; deleted Expenses and edits are opt-in. Import and recurring templates are out of
scope.

## Privacy

People are identified by stable ids and names only. Contact and account fields are projected
out. To meet "no email anywhere in the file", email addresses typed into free text (a
description, a note, a name) are replaced with `[redacted]`, and contact or credential keys are
removed from history values at any depth. Tests cover the serialized output and populated
historical participants, and the browser journey checks the downloaded file has no email.

## Period

A backup is always **all time**. The Export page disables the period and keeps Shares checked;
the server answers `from` or `to` with `format=json` with `422 VALIDATION_ERROR`. The CSV path
keeps its exact bytes (a literal expected-byte integration assertion), formula escaping and zip
behaviour.

The statement's period is a date window. Spent, the Expense count, Paid, Share and Net describe
the window; Paid and Share each sum to Spent, and the Nets sum to zero. Current all-time
balances and suggested payments include every recorded Payment and match Balances, which the
page says. Names replace "You". Payments are listed by instant in the viewer's zone, with who
recorded them and no Month subtotals. A legacy Group's currencies have a selector and stay
apart.

A whole-trip statement (`scope=trip`, opened from Share wrap-up) is captioned with the Trip's
stored dates; query bounds can't relabel it. It follows the Trip summary's rule (#316) for
Expenses dated outside the Trip's dates: they count in Spent and in each person's Paid, Share
and Net, and are named "Before the trip" and "After the trip", a line each in the Summary and
under the date in the Expenses table. Days are read as the Trip summary reads them, by instant
in the viewer's zone. A shared test checks that the statement and `tripSummary` agree on Spent,
the Expense count, the outside totals and the member's Paid and Share, in six zones and with
both dates, one date, or the dates stored the wrong way round. Payments stay windowed to the
Trip's dates; current balances include every Payment.

**Share wrap-up** sits on the Trip wrap-up card under the suggested payments, as on the design
canvas's Trip Group page, once the Trip has Expenses (also when everyone is settled up). It
links in the same tab to `statementPath(groupId, { timeZone, wholeTrip: true })`, with the
viewer's IANA zone from `Intl`. It is a read, so every member has it, whoever pays whom.

Print uses A4 with 15 mm margins, light semantic colours in both themes, no app chrome or
controls, repeated table headers and rows that don't split. Print or save as PDF calls
`window.print()`. Sideways-scrolling tables are named, focusable regions with a visible focus
outline. Amounts use `MoneyText`.

## Access

`GET /api/export` needs a session (401 without) and current membership of **every** chosen
Group before any ledger read or recurring generation; a missing Group, a former member or an
outsider gets 403. The 50,000-row cap counts Expenses, requested edits and requested Payments,
and a real 50,001-Expense request answers `413 EXPORT_TOO_LARGE` with no attachment.

The statement page checks membership the same way before reading anything. A signed-out visit
redirects to `/login` (307). A Group the member never joined, has left, or that doesn't exist
answers a real HTTP 403 (`experimental.authInterrupts` and `forbidden()`) with
`app/(main)/groups/[id]/forbidden.tsx`: inside the app's shell, the Group page's own words for
a Group the member can't open (#201), "Group not found" and "This group may have been deleted
or you don't have access.", and Back to Home. It takes no props, so it never names the Group or
says whether it exists. The access suite checks the 403, that no Group data is in the
response, and an unchanged ledger, for an outsider, a removed member and a missing Group. The
response is Next's error document, and the refusal page renders in the browser, so the demo
journey checks its words, its Home link and axe, for a Group Priya was only invited to and for
one that doesn't exist.

## Verification summary

All on the final code, with fictional data only. The browser suites used production builds
and a database of their own on a local Mongo, dropped afterwards; the pilot's browser ran in
CI's Linux image, `mcr.microsoft.com/playwright:v1.62.1-noble`.

| Check                                                                               | Result                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm typecheck`                                               | Passed                                                                       |
| `pnpm lint`                                                                         | Passed: 0 errors; the 5 existing Next navigation warnings, none in this work |
| `pnpm web check:design-system`                                                      | Passed: 68 adopted files                                                     |
| `pnpm test:unit --maxWorkers=2`, in `TZ=UTC` and in `TZ=Pacific/Pago_Pago`          | Each 205 files, 4,179 tests: shared 1,472, swarm 122, web 813, mobile 1,772  |
| Shared and web unit tests, in `TZ=Pacific/Kiritimati` and in `TZ=Pacific/Tongatapu` | Each shared 1,472 and web 813                                                |
| `pnpm test:integration --maxWorkers=2`, `TEST_MONGODB_URI` on Mongo 27018           | 36 files, 394 tests                                                          |
| Demo browser suite, production build, four projects, `--workers=1`                  | 348 passed, 32 skipped (by design), 10.1 min                                 |
| Expense-access suite, isolated production build, Mongo 27018                        | 239 passed, 3.5 min                                                          |
| Pilot, compare only, in CI's Linux browser                                          | 68 passed, 5.0 min                                                           |

The pilot's dashboard, balances and statement print snapshots all matched; nothing was
re-recorded.

## Screenshots

The demo suite saves review screenshots under `apps/web/playwright/artifacts/<project>/`
(uploaded as a CI artifact): `trip-wrap-up.png`, `trip-statement-screen.png`,
`trip-statement-print.png`, `statement-screen.png`, `statement-print.png`, `json-backup.png`
and `group-refusal.png`. They were inspected in desktop and mobile, light and dark: Share
wrap-up reads as the canvas's tonal button in both themes, print stays light in dark mode, and
the refusal page sits in the app's shell in both themes.

The tracked print baselines are `apps/web/playwright-pilot/snapshots/{desktop,mobile}-{light,dark}/statement-print.png`.

## Reviews

Before the rebase, an independent Standards review found two items (a `MoneyText` convention and
a duplicated Settlement projection), both fixed, and an independent Spec review found no
defect; it recorded Share wrap-up as waiting for #316. Share wrap-up, the before-and-after
labels and the refusal page were added after those reviews.

## Limits

- A4 output is verified through print-media screenshots and the print CSS, not a physical
  printer.
- Import, recurring-template backup, server-made PDFs and Android are out of scope.
- The browser journeys run in the machine's own time zone; the shared and component tests pin
  their zones.
- Run the demo suite on a fresh database, as CI does. A second run on the same database keeps
  the Groups the first run created, so Alex ends up in more than 50 Groups and #317's
  several-Groups zip journey meets the 50-Group cap.
- A whole-trip statement lists only the Payments recorded on the Trip's dates. Payments that
  settle the trip afterwards count in its balances but aren't listed; on the seeded Trip that
  reads "No payments in this period". Whether a whole trip should list every Payment is open
  for the owner.
