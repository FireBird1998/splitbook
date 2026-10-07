# JSON backup and printable statements

`GET /api/export?groups=<ids>&format=json&include=payments,deleted,history` returns
one UTF-8 `.json` attachment for all chosen Groups. Current Group membership is required
for **every** requested Group before any ledger is read or due recurring Expense is generated.
Missing Groups and former members receive the same 403 as CSV; signed-out requests receive 401.
The 50,000-row cap counts Expenses, requested history entries and requested payments, with the
existing `413 EXPORT_TOO_LARGE` response.

## Backup schema

The single source is `backupSchema` in `packages/shared/src/export-backup.ts`;
`Backup` is inferred from it. `buildBackup` accepts plain loaded records, with no framework
or database dependencies. Parsing a generated file through the schema validates its structure.

- `format`: exactly `splitbook-backup/1`; `exportedAt`: ISO UTC timestamp.
- `groups`: ordered by stable id. Each has `id`, `name`, `theme` (stored Theme key),
  `currency`, `startDate` and `endDate` (ISO timestamps, or null).
- `members`: stable `id`, `name` and `former`. Current members and people referenced by
  exported records or requested history are included, ordered by id. An unavailable account
  is named `Former member`. No email, image or account metadata is exported.
- `tags`: `id`, `name`, `retired` (stored `isArchived`), `deleted` (stored `isDeleted`),
  `createdAt`. Historical identities are retained; Tags are ordered by id.
- `expenses`: `id`, stored `date` as ISO UTC, `description`, `category`, stored `tag` and
  nullable `tagId`, `currency`, `amountMinor`, `splitMethod`, `notes`, `paidBy`,
  `splitBetween`, nullable `createdBy`, `createdAt`, `updatedAt`, and nullable `deleted`
  (`at`, `byId`). Allocations have `userId` and exact `amountMinor`, plus stored
  `percentage` or `shares` when present. Their stored order is retained. Expenses are ordered
  by id. Legacy major-unit money is read through the existing exact-money adapter, keeping
  each record's own currency without conversion.
- `edits`: only with `history`; each has `at`, `byId`, and `changes` with `old`/`new` JSON
  values as stored. History values retain their stored representation (including historical
  major-unit `amount` fields); current Expense amounts and allocations use minor units.
  Edits are ordered by time then editor. Populated participant objects become their stable id.
- `settlements`: only populated with `payments`, otherwise an empty array. Each has `id`,
  `from`, `to`, exact `amountMinor`, `currency`, stored recording `date` as ISO UTC,
  `note` and `createdBy`. Ordered by id.

Backups always cover **all time**. The form disables the period selector and sends no bounds.
The server **rejects** `from` or `to` with JSON format (`422 VALIDATION_ERROR`), rather than
quietly creating a partial backup. Payers and shares are always included regardless of the
CSV-only `shares` include flag. Deleted Expenses and history remain opt-in.

Contact fields are projected out. Addresses typed into names, notes or other text are replaced
with `[redacted]`; nested email/image/avatar/token/secret fields in historical JSON are omitted.
This privacy rule also applies to historical values. CSV generation and escaping remain unchanged.

Import and recurring templates are out of scope; backing up templates is a possible follow-up.

## Printable statement

`/groups/<id>/statement?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Asia%2FKolkata` is a
server-rendered page. Both dates are inclusive; omit both for all time. Expense dates follow
CSV's stored UTC calendar day, and payments follow the supplied viewer time zone.
A current-membership check precedes all ledger reads and recurring generation; missing and
inaccessible Groups return HTTP 403, and signed-out visitors redirect to login. No additional
JSON endpoint or client query cache is introduced. Next's `authInterrupts` enables the server
page's actual HTTP 403, rather than displaying a refusal with a 200 response.

`buildStatement` in `@splitbook/shared/statement` reuses the insights' member Paid/Share
helpers and the exact settlement ledger's `calculateNetBalancesMinor` and `simplifyDebtsMinor`.
Spent, Expense count, Paid, Share and Net cover the selected period. Paid and Share each sum
to Spent; Nets sum to zero. **Current all-time balances and suggested payments** include all
recorded payments and match Balances, with that distinction stated on the page. Periods never
reset debts. Payments are listed oldest first by instant, with recorder names and no Month totals.
Legacy currencies have a selector and are never combined or converted.

`scope=trip` denotes a whole-trip statement. It is refused for non-Trip Groups. Stored Trip
dates supply the caption; fabricated query bounds cannot relabel a whole trip. It follows the
Trip summary's rule (#316) for Expenses dated outside the Trip's dates:

- They count in the whole-trip figures: Spent, the Expense count, and each person's Paid,
  Share and Net.
- They are named **Before the trip** and **After the trip**: a line each in the Summary
  (amount and count, "counted in Spent"), and under the date in the Expenses table.
- Days are read as the Trip summary reads them, by instant in the statement's time zone, so
  the statement names the same Expenses, with the same totals, as the Insights tab. A shared
  test checks this against `tripSummary` in several zones.

Payments are still windowed to the Trip's dates, and current balances still include every
payment. The page explains this scope.

The browser's **Print or save as PDF** calls `window.print()`. Print CSS requests A4 with 15mm
margins, hides app chrome and controls, repeats table headers and avoids splitting rows. It
always uses the existing light semantic paper, text and border tokens. Screen tables have
named, focusable scrolling regions and visible keyboard focus in both themes.
