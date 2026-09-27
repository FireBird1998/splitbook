# Ledger hardening verification — 16 September 2026

Implementation of specification [#39](https://github.com/FireBird1998/splitbook/issues/39) and tickets [#40–48](../plans/2026-09-16-ledger-hardening-tickets.md) on `codex/ledger-schema-hardening`. Production deployment and production migration are separate actions and were not performed.

**Result: 627 distinct automated checks passed, plus executable migration/query rehearsals and static/build checks.**

## Delivered behavior

- Integer minor-unit money coexists with legacy fields. Currency precision, safe ranges, participant uniqueness and both allocation totals are validated. Equal, weighted and percentage calculations distribute all units deterministically.
- Manual and recurring writes use the same arithmetic. Metadata edits preserve historical penny placement and currency. Legacy records receive a revision safely before their first concurrent mutation.
- Expenses and Settlements accept scoped submission keys. Concurrent/retried commands return one record; changed payload reuse conflicts. Financial writes contain durable, immutable Activity intents, recovered idempotently after a publication outage.
- Revision preconditions reject stale edits, deletes, restores and recurring changes. Editors preserve their drafts through conflicts and background Group refreshes, with explicit reload actions.
- Tags have stable identities. Rename/filter/recurring relationships survive name changes. Deletion retains internal identity; an admitted concurrent write cannot leave a dangling relationship.
- Balances and summaries keep currencies separate. Historical foreign-currency balances are individually visible. New financial records lock Group currency, including against a racing currency change.
- Lists omit edit history and private retry/outbox metadata; details retain the history. Balance queries project financial data. The compound list index supports the default sort without an additional sort stage in the tested query plan.
- The migration command defaults to audit. Combined money, Tag and metadata audits block incompatible data before writes. Application is repeatable and preserves amounts, history, original display fallbacks and Activity counts.

## Verification

| Check                                                          | Result                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| Shared domain tests                                            | 168 passed                                             |
| Web unit/database integration tests                            | 243 passed                                             |
| Authenticated request and targeted browser suite               | 92 passed                                              |
| Core desktop/mobile × light/dark journeys                      | 40 passed                                              |
| Simulated Google OAuth                                         | 7 passed                                               |
| Production design-catalogue exclusion                          | 1 passed                                               |
| Linux component catalogue, accessibility and visual checks     | 20 passed                                              |
| Linux pilot recovery/loading/focus/accessibility/visual checks | 56 passed (52 initial + 4 updated currency assertions) |
| Workspace lint, TypeScript and Prettier                        | Passed                                                 |
| Adopted design-system policy                                   | Passed, 8 files                                        |
| Final production build                                         | Passed                                                 |

Additional adversarial coverage includes one-cent mismatches, JPY fractional units, duplicate participants, amount-only invalid edits, concurrent same-key Expense/Settlement creation, simultaneous stale editors, removed-member replays, missing revision headers, canonical/legacy representation drift, preservation of old split distributions, Activity failures before and after publication, unrelated duplicate-key failures during recurring generation, migration interruption and reruns, orphan Tag mappings, and the first-write/currency-update race.

The executable migration was rehearsed against a freshly created isolated database with Expense, recurring template and Settlement records. Default audit left it unchanged; invalid money caused exit 2 before any mutation; valid application and a repeated application returned exit 0; final audit had no work remaining. The database was removed afterward. Evidence is in `apps/web/output/playwright/ledger-migration/`.

## Synthetic read comparison

A disposable fixture contained 1,000 Expenses across five Groups, including 900 active records and 40 history entries per Expense. Exact IDs, counts, contribution fields, per-currency totals, user balances and list ordering matched before and after projection/index changes.

| Read                            | Full document JSON | Current projected JSON | Reduction |
| ------------------------------- | -----------------: | ---------------------: | --------: |
| Dashboard balances, 900 records |   19,354,663 bytes |          404,758 bytes |    97.91% |
| Expense list, 20 records        |      430,112 bytes |           18,192 bytes |    95.77% |

The unhinted default list query examined 180 keys/documents and performed a blocking sort with the previous indexes. After explicit index creation it examined 20 keys/documents and needed no blocking sort, returning the same 20 records in the same order. Evidence and the reproducible fixture script are in `apps/web/output/playwright/ledger-migration/read-rehearsal.{json,txt,cjs}`.

These are raw Mongo JSON payload sizes on deliberately history-heavy synthetic data, excluding user population, HTTP envelopes, compression and network latency. They are not production performance measurements. Summary calculations still scan relevant financial rows; this change does not introduce materialized balances. The earlier summary used a server-side aggregation, so no full-document comparison is claimed for that query.

## Findings corrected during verification

- A Zod partial-update default changed Expense category during restore. PATCH schemas now leave absent category fields absent.
- A full-form metadata save could redistribute historical rounding units. Services compare the financial definition and preserve stored allocations when it is unchanged.
- Missing legacy revisions could undermine the initial concurrency check. Conditional initialization precedes versioned writes.
- A background Group refresh could reset open Expense drafts. Initialization now follows dialog/record identity and explicit reload.
- An editor could replace a historical Expense currency with the Group default. It now retains the record's currency and precision.
- A form could show a green total indicator for a one-cent mismatch. Indicators and validation now compare exact units.
- A successful create with a lost response could trigger the duplicate-warning prompt on retry. Retries now bypass that preflight and reuse the committed submission key.
- Legacy floating-point tails accepted by migration/read compatibility could fail strict metadata edits or recurring generation. Stored values now cross the compatibility reader before populating exact editable values; new input remains strict.
- Reusing a deleted Tag name could incorrectly block a later ID-based rename. Only genuinely ambiguous legacy references block backfill.
- Malformed or non-BSON Tag/Group identities could pass initial migration auditing. The combined audit now rejects them before money migration.
- Canonical balance reads could miss disagreement between the root amount and both participant totals. Stored-record validation now checks all three.

The pilot mixed-currency assertion was updated because the old warning claimed balances could be inaccurate. The new response fixture includes separate currency buckets and verifies the visible currency selector. Existing unrelated visual snapshots were retained.

## Evidence and practical limits

- New ledger screenshots: `apps/web/output/playwright/ledger-hardening-visual/`.
- Migration rehearsal and Tag screenshots: `apps/web/output/playwright/ledger-migration/`.
- Full run logs are copied into `apps/web/output/playwright/ledger-hardening-verification/` after final checks.
- Existing Settings/profile/default-currency and wider contrast findings in [the earlier QA report](2026-09-16.md) remain outside this approved scope. The changed conflict feedback received a targeted contrast check.
- Exploratory inspection also showed the existing desktop floating Add button can overlap a Net positions amount at a particular scroll position. The separate currency balance and debt remain readable above it; this layout issue is not a money calculation defect.
- Google authentication uses the repository's synthetic provider. Real Google, Atlas, Vercel, Safari, Firefox and physical mobile devices were not exercised.
- Pilot fault scenarios use controlled responses; request and database integration tests provide the corresponding backend evidence. This is not load testing or a comprehensive security/assistive-technology audit.
- Activity recovery limits work per feed request. Mongo reconnection time can exceed the nominal recovery deadline; pending events remain durable. Sustained publication failure eventually stops further mutations at the documented outbox capacity.
- Run the [migration runbook](../operations/ledger-migration.md) with writers stopped, a verified backup and compatible application code. No live financial corrections are inferred automatically.

## Cleanup and delivery

The pre-test demo and OAuth databases were restored from their backups after the suites that reset them. Demo collection counts returned to 41 Groups, 47 Expenses, 131 Activities, 92 sessions, 3 users and 1 Settlement. The test-only Linux browser container was stopped and removed. Synthetic migration/query databases were removed. MongoDB was returned to its original stopped state; no QA servers remained on ports 3100, 3101, 4128 or 4129. The working `splitbook` database and production services were not used.

Implementation remains in the local working tree on `codex/ledger-schema-hardening`; no commit, push, production deployment or production migration was performed. The previously published specification and nine implementation issues remain available for review. Existing `.claude/` content was left untouched.
