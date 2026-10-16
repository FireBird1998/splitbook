# Expense dates migration

An Expense's date is a calendar day, stored at midnight UTC (#437, owner decision of 2026-10-16). Android's Add expense stored local noon before, so older Expenses are stored at other times of day. This migration moves each of them to midnight UTC on the day it falls on in UTC, which is the day every screen now shows. It changes nothing else: not the revision, `updatedAt`, history or Activity, because the day stays the same.

The command is read-only unless `--apply` is present.

## Before applying

1. Deploy the build that stores and shows Expense dates as calendar days first. Until then, an older Android build or web server can still store local noon, and the audit would find it again.
2. Stop writers for the run, take a backup and use the same target throughout, as for the [ledger migration](ledger-migration.md). The script reads `apps/web/.env.local`, and an existing `MONGODB_URI` environment variable takes precedence. It prints the database name, never the URI.

## Audit, apply and verify

From the workspace root:

```sh
pnpm web migrate:expense-dates
pnpm web migrate:expense-dates --apply
```

The audit prints its report and how many Expenses would move. `--apply` moves them, prints how many it moved, then audits again and fails if any remain. Each move checks the date it read, so an Expense changed meanwhile is reported, not overwritten.

- `alreadyDays`: Expenses already at midnight UTC.
- `planned`: Expenses to move.
- `moved`: Expenses moved by this run.
- `lateInUtcDay`: of those planned, the Expenses stored at 22:00 UTC or later. Local noon in a zone 13 or 14 hours ahead of UTC (Tonga, Kiribati, New Zealand in summer) is stored on the day before in UTC, so a member there may see such an Expense one day earlier than they picked. The same times also come from zones 10 or 11 hours behind UTC, where the day is right. Report the count to the owner. It is not corrected automatically.
- `issues`: Expenses whose date can't be read. While any remain, nothing moves, and the command exits with status 2. Correct them through a separately reviewed change.
