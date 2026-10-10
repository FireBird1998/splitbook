# Permanent cleanup of a Group with no members

A final member must confirm that leaving permanently deletes the Group, Expenses, Settlements and Activity. Cancel sends no request. Missing or false `deleteIfLastMember` receives `409 GROUP_DELETION_CONFIRMATION_REQUIRED` and preserves membership. Stale ordinary-leave confirmations must show the destructive warning and require another explicit tap. Other members retain the existing balance and last-admin checks. Archive alone never authorizes deletion.

A confirmed claim atomically clears the actual sole membership, disables invite codes, marks the Group as unavailable and records a durable deletion request. Each batch removes at most 100 records from one dependent collection. Expenses include soft-deleted records and embedded pending Activity/retry metadata. The Group is removed only after Expenses, Settlements, Activity, RecurringExpenses and Invitations are empty. Accounts, sessions, other Groups and external receipt/image objects are outside the cascade.

`deleted: true` means the six collections are cleaned. A bounded response may instead return `deleted: false, deletionPending: true`: membership has ended, but cleanup has not finished. The clients discard this Group's saved copies and unsent drafts under the existing access-denial rules; they do not replay financial saves automatically.

## Mongo capability and rollout

The shared Group transaction fence requires a replica set or Atlas. Standalone Mongo returns `409 GROUP_DELETION_UNAVAILABLE` before removing the final member. Ordinary reads, financial writes, multi-member leave and archive remain available on standalone. No owner database, local Docker topology or environment is changed by this feature.

Before allowing destructive operations, upgrade **every backend instance and administrative/maintenance writer connected to the target database** to this fence code. A previous deployment still writing without the fence can create records after deletion; the new transactions cannot protect against that writer. Drain old deployments/in-flight jobs first. Confirm transaction support and rehearse on a fictional replica-set database before enabling a real environment. No real purge or deployment is authorized by the feature's implementation ticket.

Live Group IDs are immutable: never recreate a deleted Group ID while its receipt may exist. New Groups receive new IDs. The raw ledger migration CLI retains its existing update-only, exclusive offline seam; stop app/cleanup writers and keep access closed until migration verification finishes. Demo seed/reset scripts are restricted to exclusively owned fictional fixtures and must not run concurrently with cleanup or any active app writer. No real database seed/reset is authorized by this feature.

No data migration is needed. The first explicit claim/apply creates `groupdeletions` indexes: the `_id` uniqueness already supplied by Mongo, an index for pending requests, and a TTL index on completed receipts' `expiresAt`. Inventory and manifest dry-run create no indexes. Pending jobs have no expiry. Completed receipts contain only Group ID, requesting actor ID or manifest fingerprint, state, timestamps and cursor; they expire after seven days. TTL removal is asynchronous. Once a receipt has expired, replaying leave returns the usual unavailable/404 result and cannot recreate the Group; clients should reload Home rather than expect an indefinitely retained success receipt.

## Recovery

A response attempts at most 12 deletion batches and a two-second total transaction budget. A queued recovery pass considers at most three explicitly recorded pending requests, advances at most two batches per request, and has a 500ms overall budget. Attempt timestamps rotate malformed or changed requests so an old blocked job does not permanently starve healthy jobs. Each transaction also has a bounded driver timeout. Delayed Expense, Settlement, recurring generation/marker, invitation and Activity writes share the parent fence; transaction retries repeat only work inside that commit boundary.

Authenticated Group-list reads and pending consented leave responses use Next.js `after` to schedule a queued pass after the response. Cleanup is never awaited by ordinary display reads and does not add a new Add Expense opening delay. This is traffic-triggered recovery within the platform request lifetime, **not an independently running worker**. With no app traffic, an operator can explicitly resume recorded jobs through the command below. A crash leaves the cursor and pending job in Mongo for the next pass. No cron, deployment secret or financial retry queue is added.

## Read-only inventory

Run from the repository with the intended environment's `MONGODB_URI` already supplied securely; the CLI also honors the web app's existing `.env.local` loader. Never paste credentials into command examples or reports.

```sh
pnpm web groups:orphans --environment staging --database splitbook --output orphan-report.json
```

Default behavior is raw read-only inventory. The explicit database must equal the URI database and cannot be `admin`, `config` or `local`. The report includes environment, database, timestamp, Group ID/name/theme, archive status, actual member count, updated time/revision and dependent-record counts. It omits emails, auth data, descriptions and money. Only an actual empty members array is eligible. Missing or malformed membership and unresolved User references are preserved.

`missingParents` separately reports dependent records whose **ObjectId** Group reference has no parent. String, missing, null and other malformed foreign-key values are excluded from that aggregation; an empty `missingParents` report does not audit arbitrary malformed legacy references. Audit those separately before drawing a broader conclusion. Missing-parent records never expand maintenance deletion scope. Existing historical empty Groups are never discovered or swept by the recovery queue.

## Reviewed maintenance selection

Show the report to the owner before any real purge. Create a reviewed manifest by retaining only the approved entries in `groups` and adding `selectedGroupIds` with exactly those IDs, once each, in the same order. Retain `version`, environment/database identity, `generatedAt` and `missingParents`. The strict manifest accepts at most 100 Group entries. Review the exact file and target again before applying it.

```sh
# Explicit manifest still defaults to read-only validation.
pnpm web groups:orphans --environment staging --database splitbook --manifest reviewed-orphans.json

# Separate owner-approved action only, against a transaction-capable database.
pnpm web groups:orphans --environment staging --database splitbook --manifest reviewed-orphans.json --apply --output apply-result.json

# Explicit operator recovery processes recorded requests only.
pnpm web groups:orphans --environment staging --database splitbook --resume --apply
```

Fresh checks compare actual empty membership, identity/name/theme/archive, revision/update time and all dependent counts inside the claim transaction. Changed records return `changed` and remain untouched. A different selection or target is rejected. Matching duplicate execution resumes the same manifest fingerprint. The command reserves an output file exclusively before any database action; an existing file fails before a destructive claim. Dry-run/apply are mutually exclusive, resume requires apply, and unknown/duplicate/incomplete arguments fail safely. Reports are not overwritten.

## Fictional verification topology

Full CI starts a separate `mongo:7.0.39` replica-set container on loopback 27038 with test commands enabled, initializes it, and removes that owned container afterward. The existing standalone service on 27017 remains for compatibility coverage. Test-only failpoints are scoped by the feature test client's `appName`; they are disabled in `finally`. Never enable test commands on an application database.

```sh
TEST_MONGODB_URI='mongodb://127.0.0.1:27038/?directConnection=true' \
STANDALONE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?directConnection=true' pnpm test
```

Feature/CLI tests fail instead of skipping when their replica-set prerequisite is absent; the standalone compatibility test fails if accidentally pointed at a replica set. `pnpm web test:group-cleanup-http` drives real demo sessions and routes against an explicitly supplied, ownership-marked fictional loopback backend. Its raw persistence oracle and cleanup are limited to that fixture database and this run's created Group IDs. It also proves pending cleanup advances through real `after(response)` reads without a consented leave replay. Independent web/Android accessibility, visual and frozen-release QA remain required before publication.
