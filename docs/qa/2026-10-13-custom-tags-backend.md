# Custom Tag backend verification — 13 October 2026

Backend implementation is local only. No live database, GitHub publication, deployment, Metro process, emulator or phone was used for this slice.

## Contract and topology

The authenticated Tag action routes use the shared command/result schema. Every command commits its effect and an account/Group-scoped receipt together in a Mongo transaction, fenced with Group mutations and account cleanup. Receipt checks only read. Existing Tag URLs require a request ID and, for existing Tags, the reviewed revision. Internal Group service helpers delegate to the same mutation owner.

Tag changes require a Mongo replica set or mongos. Standalone Mongo serves snapshots and receipt checks but returns `503 TAG_TRANSACTIONS_REQUIRED` for Tag writes, before an effect or receipt can be written. This is an intentional fail-closed limitation. Expense/Settlement standalone behavior remains covered separately.

Historical missing Tag arrays project to an empty list without persistent backfill; admins can explicitly create or restore an active Tag. Group cleanup appends `tagactions` to the stable collection registry. Older cleanup manifests default the new receipt count to zero. Account cleanup removes receipts under the existing user deletion fence, which also blocks late Tag submissions.

## Focused evidence

All data was fictional and stored in per-file `splitbook-test-*` databases. The replica target was `mongodb://127.0.0.1:27213/?directConnection=true` (Mongo 8.0, `tag-actions` replica set). The standalone target was `mongodb://127.0.0.1:27215/?directConnection=true` (Mongo 7.0.39).

- Initial RED: the new authenticated route test failed on missing Tag action endpoints. The create/check/replay implementation then passed.
- Stale rename RED: rename returned 400 before implementation. After implementation, stale revisions return `409 TAG_CHANGED`; exact retry confirms the old receipt and separately shows current state.
- Archive/restore RED: archive returned 400 before implementation. Concurrent attempts to delete the final two active Tags now admit one winner and reject the other with `LAST_ACTIVE_TAG`.
- Legacy-form RED: an unkeyed old POST returned 200. Old mutation URLs now reject missing keys/revisions with 428.
- Cleanup RED: account cleanup initially left an applied receipt readable. Receipts are now removed and later mutations refused.
- Historical compatibility RED: a Group missing its Tag array returned 500. It now reads empty and permits explicit creation.

The route suite covers all five actions after a lost reply and a superseding change, read-only check, exact retry, reused keys, stale unapplied requests, account and Group scope, role-only permission loss versus membership loss, archived duplicate names, duplicate-name races, last-active races, historical zero-active Groups, and account cleanup. Only Better Auth's session boundary is substituted; routes, authorization, domain behavior and Mongo persistence execute normally.

Commands run from the worktree root:

```sh
TEST_MONGODB_URI='mongodb://127.0.0.1:27213/?directConnection=true' corepack pnpm web exec vitest run 'src/app/api/groups/[id]/tag-actions/route.integration.test.ts' src/lib/services/tag-identity.integration.test.ts src/lib/services/expense-settlement.integration.test.ts src/lib/services/recurring-expense.integration.test.ts src/lib/services/group-leave.integration.test.ts
STANDALONE_TEST_MONGODB_URI='mongodb://127.0.0.1:27215/?directConnection=true' corepack pnpm web exec vitest run src/lib/group-cleanup-standalone.integration.test.ts
TEST_MONGODB_URI='mongodb://127.0.0.1:27213/?directConnection=true' corepack pnpm web exec vitest run src/lib/group-cleanup.integration.test.ts -t 'removes all Group-owned'
corepack pnpm web typecheck
```

Results: 71/71 related route/service tests; 2/2 standalone tests; 1/1 selected cleanup test. Typecheck, changed-file ESLint and formatting passed. Existing Tag identity regressions were preserved unchanged. Existing Playwright HTTP fixture actions now provide request IDs and current reviewed revisions.

Real session-cookie HTTP, rendered web/Android journeys, full workspace gates, the frozen Android build, and independent Standards/Spec review belong to the integrated verification task. This note does not claim those checks. The local Mongo 8 replica did not enable failpoints; the integrated task owns a Mongo 7 replica with test commands enabled for full cleanup/race coverage.

## Mongo 7 cleanup follow-up

After the integration task made its isolated failpoint-enabled Mongo 7.0.39 replica available on port 27214, the complete Group-cleanup suite, Tag action route suite and standalone suite passed together: 41/41 tests. The receipt collection also has an actor-only index for account cleanup, in addition to the unique Group/actor/request ID index.

```sh
TEST_MONGODB_URI='mongodb://127.0.0.1:27214/?directConnection=true' STANDALONE_TEST_MONGODB_URI='mongodb://127.0.0.1:27215/?directConnection=true' corepack pnpm web exec vitest run 'src/app/api/groups/[id]/tag-actions/route.integration.test.ts' src/lib/group-cleanup.integration.test.ts src/lib/group-cleanup-standalone.integration.test.ts
```
