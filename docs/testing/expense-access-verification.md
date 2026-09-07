# Expense access verification

Implementation of private Splitbook spec #16 and tickets #17–#19.
Verified locally on 6 September 2026; starting checkout was `684bff7`.
The user confirmed `684bff7` as the review baseline. Implementation checkpoint:
`5ebfc3a`. Two-axis review and follow-up review are complete; both findings below
were addressed before the final follow-up commit.
No push, deployment or working-data reset is included.

## Red before green

The regressions used actual authenticated HTTP requests, synthetic Groups and
Expenses, and a unique loopback-only MongoDB database for each run.

| Operation   | Before its fix                                                                | After its fix                       |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| Read        | Cross-group request returned 200 with the other Group's Expense               | 404, same body as an absent Expense |
| Edit        | Cross-group PATCH returned 200 and changed contents, history and activity     | 404; all observed records unchanged |
| Restore     | Cross-group PATCH returned 200 and cleared deletion metadata, adding activity | 404; all observed records unchanged |
| Soft delete | Cross-group DELETE returned 200 and changed deletion metadata/activity        | 404; all observed records unchanged |

Each first regression was executed and observed failing before changing that
operation. The edit and restore regressions share the existing PATCH interface.
Denied-write assertions read the Expense (including edit history) and both
Groups' activity feeds through authorized HTTP requests before and afterward.
No assertions depend on query shape, mocked membership or private helper calls.

## Review

### Standards

One low-severity Duplicated Code finding: three standalone regression tests
repeated the shared matrix. Removed the duplicates without dropping their
rejection or unchanged-ledger assertions. Follow-up review: no hard violations
or actionable heuristic findings remain.

### Spec

One P2 compatibility finding: moving PATCH validation ahead of membership changed
outsider/revoked-member responses from 403 to 422 for invalid payloads and 500 for
malformed JSON. Four new authenticated request tests reproduced those failures
before the fix. Restored the PATCH adapter's membership preflight solely for
response ordering; the expense module still independently enforces membership
and Group/Expense binding. All four new cases pass, including unchanged ledger,
history and activity. Follow-up review: no remaining spec findings.

Initial findings: Standards 1 (low-severity duplication), Spec 1 (P2 response
compatibility). Remaining findings after fixes: Standards 0, Spec 0.

## Passing checks

- `pnpm web test:expense-access`: **54 passed after review fixes**, covering the four operations with
  manual and genuinely generated recurring Expenses; disjoint/overlapping
  membership; outsiders; same-session membership revocation; anonymous redirects;
  identical missing-resource responses; successful non-admin/non-creator actions;
  validation, forbidden-before-invalid-body responses, unchanged archived Tags,
  attribution, restoration and repeated deletion.
- `pnpm test`: **264 passed in 37 files after review fixes**, including expense/history, balance,
  recurring, arithmetic, demo/Google auth and design-system regressions.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `git diff --check`: passed.
- Production build (`next build --webpack`) in the env-free temporary source
  copy with synthetic configuration: passed, including its TypeScript check.
- Existing `demo-journeys.spec.ts`, desktop-light: **6 passed** (including expense
  creation/editing and settlement).
- Existing `playwright-google` suite: **6 passed**, using the local OIDC stand-in,
  including approved and denied callbacks.

For these two existing browser suites only, the source was copied to a temporary
directory without environment files. Temporary configurations disabled server
reuse and replaced their persistent database names with two exact
`splitbook-test-*` names. Both disposable databases were dropped after the runs.
The working server, local OAuth configuration and persistent demo ledger were
not changed. This was a desktop browser regression, not a new visual-baseline run.

The request suite is reproducible via its committed config and now runs in CI.
CI itself has not been run remotely. Existing middleware-deprecation and runner
listener-count warnings appeared during local tests; they did not fail assertions.

## Limits

This verifies the scoped single-Expense access contract, not a codebase-wide
authorization audit. It does not add transactional guarantees against membership
revocation racing an authorized write, change expense normalization or financial
rules, or change Google/demo authentication policy. All real private-beta data
and production infrastructure remain outside the test scope.
