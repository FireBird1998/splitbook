# Ledger creation characterization

Ticket #77, under unchanged parent #73. Accepted baseline: `9c6de8e823008b7c5237164349fd8a56dd4848b0`, recorded in [#70 completion](https://github.com/FireBird1998/splitbook/issues/70#issuecomment-5890216981) and [the baseline handoff](2026-09-29-expense-baseline-handoff.md). #70 was closed before this characterization began. This slice changes tests only.

## Observed guarantees

- Existing authenticated concurrency tests exercise four matching requests and mismatched payloads for both writers; existing browser tests commit the actual financial write before losing its response and retry through the form.
- New authenticated tests verify actor/Group-scoped identity, unkeyed compatibility, Expense participant-departure replay versus new-write rejection, Settlement party membership and removed-actor denial, both Expense array-order fingerprints, and historical Tag rename/archive/reassignment/deletion replay through the original alias.
- Replay returns the current record. Expense detail GET populates history editors while creation/replay POST retains their IDs; tests preserve this existing projection difference. Settlement has no edit endpoint, so its current-record test amends only a note through an isolated fixture and compares authenticated replay with authorized list read-back.
- Explicit and omitted defaults converge. Historical replay occurs before new-write currency checks. Isolated Group currency drift is restored before asserting unchanged authorized records, Balances and Activity.
- Real Mongo creation-interface tests inject response preparation failure, hold two real inserts until both initial lookups finish, exercise a real unrelated unique index collision, interrupt Activity storage and interrupt acknowledgement after publication. No successful financial commit is mocked and no production fault endpoint is added.
- Each recovery case verifies one financial record, one Balance effect and eventual one creation Activity. Pending intent survives publication/acknowledgement failures; unrelated collisions without a matching scoped record propagate.

## Ordering difference for #78

Fresh Expense creation attempts publication before response preparation; fresh Settlement creation prepares the response first. A forced population failure therefore leaves Expense Activity published and acknowledged, while Settlement still has one pending event and no first publication attempt. Both normal replay and collision recovery already publish first. Matching retries recover either record without another financial effect. This is an ordering gap, not lost ledger data or a duplicate financial effect.

## Verification and review

Characterization source/test revision: `febd936` (following `23c6a45`).

- `pnpm --dir apps/web exec vitest run src/lib/services/ledger-creation-recovery.integration.test.ts`: 10 passed against disposable MongoDB, including real insertion races and fault recovery.
- `CI=1 pnpm --dir apps/web exec playwright test --config playwright.expense-access.config.ts ledger-creation-replay.spec.ts ledger-money.spec.ts retry-ui.spec.ts ledger-recovery-ui.spec.ts`: 39 passed in 30.0 seconds; isolated production build passed.
- Web type checking and targeted ESLint passed on the characterization addition; files formatted with Prettier.
- Separate Standards and Spec source reviews: 0 findings each. Reviewers did not independently rerun the suites.

Commands use `npm_config_manage_package_manager_versions=false` for this host's pnpm wrapper limitation. The harness builds a clean production snapshot without environment files and allocates a UUID test database. New integration tests allocate a UUID database on the task-owned standalone Mongo container at loopback 27017; the user's persistent 27018 instance is untouched.

Initial test development exposed a too-long generated database name and an inverted Settlement fixture Balance expectation; both were corrected to the database limit and the existing payment-credit convention. The first browser run passed 35 cases and failed the overstrict detail-vs-replay projection expectation; a later 38-pass run revealed that correction had not been retained, now fixed in `febd936`. One isolated build hit the previously observed `next/font` loader failure; a clean retry built successfully without configuration changes. These are reported failures, not passing acceptance runs.

Synthetic demo sessions exercise actual authenticated application requests but do not verify live Google OAuth. No production work, schema change, UI change or visual-baseline update is included. Parent #65/#73 and plans remain unchanged. The broader final regression run belongs to #79.
