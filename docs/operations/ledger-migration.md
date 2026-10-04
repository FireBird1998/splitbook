# Ledger hardening migration

This migration adds exact money fields, stable Tag references, record revisions and Group currency locks. It retains the legacy major-unit values and Tag display text. It never redistributes historical splits, changes amounts, infers renamed Tags, or creates Activity entries.

The command is read-only unless `--apply` is present. Production execution and deployment are separate operator actions; development verification uses isolated local test databases.

## Before applying

1. Prepare the compatible application build, enter a maintenance window and stop all writers before deploying it or applying the migration. Stop web processes, recurring generation reads, scripts, workers and older application instances that can write to the target database. Keep application access closed until migration verification is complete. An older application instance can write only legacy fields and invalidate the new representation.
2. Verify the target database. The script reads `apps/web/.env.local`; an existing `MONGODB_URI` environment variable takes precedence. It prints the database name but never the connection URI. Use the same target for backup, audit, apply and verification.
3. Take a database backup and rehearse restoring it into a separate database. Keep the backup outside the repository. Retain the application version and audit output with the backup.
4. Run an audit and resolve every reported issue before applying. Audit and apply are not substitutes for stopping writers; there is no cross-collection transaction on standalone MongoDB.

## Audit and resolve

From the workspace root:

```sh
pnpm web migrate:ledger
# Equivalent explicit read-only command:
pnpm web migrate:ledger --dry-run
```

The coordinator audits money, Tags and rollout metadata before either migration can write. Any unresolved issue blocks `--apply` before changes begin. A blocked command exits with status 2; command/configuration failures exit with status 1.

Money issues include unsupported currency precision, incomplete or inconsistent canonical values, missing or duplicate participants, and payer/split totals that do not equal the Expense amount. The audit permits a tiny floating-point representation tail from legacy JavaScript arithmetic but rejects actual fractional minor units. Historical allocations are preserved exactly. Resolve invalid records through a separately reviewed correction; never fix an audit by automatically rounding, rerunning a split method or inventing a payment.

Tag matching uses an exact, unambiguous name within the same Group. Archived and retained deleted Tags participate in matching because both may have historical references. Unknown names, duplicate names, foreign identities and missing Groups require review.

For an orphan name whose identity is known, supply an explicit JSON mapping:

```json
[
  {
    "groupId": "b00000000000000000000010",
    "legacyTag": "Old rent name",
    "tagId": "b00000000000000000000011"
  }
]
```

The target Tag must already exist in that Group. Names are matched exactly, including case. A mapping does not create, merge, rename or unarchive Tags; it only identifies the correct historical association. A mapping cannot silently replace an existing invalid `tagId`. Retain the reviewed mapping outside the repository when it contains live data.

```sh
pnpm web migrate:ledger --dry-run --tag-mappings /absolute/path/reviewed-tags.json
```

Review `money.planned`, each Tag collection's `planned`, metadata counts and all issue lists. Zero issues is required before application. Existing invalid revisions or records referencing missing Groups also block migration.

## Apply and verify

With writers still stopped and the backup verified:

```sh
pnpm web migrate:ledger --apply --tag-mappings /absolute/path/reviewed-tags.json
# Omit --tag-mappings when the audit does not require one.
```

After the combined audit succeeds, the command:

1. Adds exact money fields without changing legacy amounts or allocations.
2. Adds missing Tag identities without changing the stored display fallback.
3. Adds revision `0` only where Expense or recurring-template revisions are missing.
4. Locks the currency of every Group with any Expense, Settlement or recurring template, including soft-deleted Expenses and paused templates.
5. Creates required unique request/recurring indexes and targeted Expense read indexes.
6. Audits again and fails if issues or planned work remain.

Index creation may reject pre-existing duplicate request keys or recurring periods. Keep writers stopped if it fails and review the duplicates. Do not delete financial records merely to satisfy a unique index.

Rerun the read-only audit independently. Compare Expense, Settlement and template counts, per-currency totals, balances, soft-deletion state, recurring periods, edit history and Activity counts with the backup/rehearsal. Exercise create, edit, retry, restore, settlement and recurring flows using the compatible application before ending maintenance. Confirm indexes exist before claiming retry or recurring uniqueness guarantees.

## Interruption and recovery

Each record update compares the original source data. Completed records are skipped on rerun; partial progress is safe to audit and resume. If a conflict appears, keep writers stopped, investigate the competing writer, audit again, then rerun `--apply` after resolving it. Legacy fields remain available throughout.

If rollback is needed before writers resume, restore the verified backup and the matching application version together. Do not restart an older writer against migrated data or blindly remove canonical fields. Once new writes have occurred, restoring the old backup loses those writes; first reconcile them through a separate recovery procedure.

## Tag retirement behavior

Deleting an unused Tag hides it from management and future selections while retaining its identity and name internally. Expenses, including deleted Expenses, and recurring templates, including paused templates, block ordinary deletion. A write admitted immediately before deletion may still finish afterward; the retained Tag keeps that historical association readable. This guarantees that IDs do not dangle, rather than claiming cross-document serialization on standalone MongoDB.

## Local rehearsal

Use an explicitly named isolated database. Never rehearse against persistent demo data or a production URI:

```sh
MONGODB_URI='mongodb://127.0.0.1:27017/splitbook-test-ledger-rehearsal?directConnection=true' pnpm web migrate:ledger --dry-run
```

The integration suite covers combined audit blocking, successful application, reruns, bounded Tag migration interruption, legacy values, explicit mappings and required indexes. Run it with the normal workspace test commands; those tests create and remove their own isolated databases.

### Synthetic read rehearsal

To reproduce the projection and index comparison against local MongoDB on port 27017, run from the workspace root:

```sh
pnpm web exec tsx scripts/rehearse-ledger-reads.mjs
```

The [rehearsal script](../../apps/web/scripts/rehearse-ledger-reads.mjs) creates 1,000 synthetic Expenses in a new, randomly named `splitbook-test-read-*` database on `127.0.0.1`. It accepts no target overrides, ignores environment database settings, checks the database is empty before using it, and removes only that database afterward. It checks IDs, counts, exact balances, allocations, list fields and ordering before writing reports to `apps/web/output/playwright/ledger-migration/read-rehearsal.{json,txt}`. Reports compare raw JSON payload sizes and unhinted query plans; they do not measure production latency.

## Client compatibility

Expense and recurring-template reads expose `revision` (legacy records start at `0`). Their PATCH and DELETE requests must send that displayed revision in `X-Splitbook-Revision`. Don't send it in `If-Match`: a host may evaluate that header as an HTTP precondition and answer 412 after the change was saved. The server still reads `If-Match` from older clients that send only that; when both are sent, `X-Splitbook-Revision` decides. Missing or malformed revisions return 428; stale revisions return 409. Retain the user's draft and reload explicitly before retrying. Restore uses the revision returned by the preceding delete, so an intervening edit cannot be overwritten by Undo.

Expense and Settlement POST requests accept `Idempotency-Key` values of 8–128 ASCII letters, digits, `.`, `_`, `:` or `-`, beginning with a letter or digit. Scope is the operation, Group and authenticated actor. Keep the same key and payload after an uncertain response; choose a fresh key for a genuinely new submission. Reusing a key for changed data returns 409. Keys remain attached to records after edits or soft deletion. Older unkeyed creates remain supported but do not have retry deduplication.

Clients continue sending major-unit amounts. The server derives `moneyVersion: 1`, `amountMinor`, payer amounts and split amounts from the validated command; independently supplied canonical fields cannot override those calculations. Prefer `tagId` for selection and filtering. A legacy `tag` name remains accepted only when it resolves safely within the Group. Balance responses retain the default-currency fields and additionally expose `byCurrency`; list summaries expose `totalsByCurrency`. Never add those buckets without an explicit exchange-rate feature.
