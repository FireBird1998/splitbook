# To review field guidance and quick fixes — #712

Implements the first slice of spec #709, reviewed against `45485342`.

The shared model retains the field, reason, decimal precision and member-row path before
rendering guidance. Android field guidance and its existing assistant explanation consume
that meaning. Both clients use the shared quick-fix interface, which covers payer and Tag
needs by field identity and renders only the remaining needs. Eligibility, suggestions,
multi-payer exclusions, ordering and explicit saving are unchanged.

## Caller audit and the next slice

Removed Android's comparisons with `who paid`, `what it was for`, `the date`, `the tag`,
split/payer/percentage total wording, and the amount wording/prefix recognizer. Removed the
quick-fix `COVERS` English map and the fact-to-wording-to-comparison round trip.

`missingFacts`, `unknownFacts` and `label` remain derived display projections of `needs`.
`memberProblems` still compares its derived Needs text to suppress repeated explanations;
its Theme currency enumeration and phrase comparisons are deliberately left for #713.
Incoming legacy validation reasons and server problem paths are still interpreted by
`validationNeed`, `problemPath` and `reviewProblem`; the server contract and stored Draft
representation have not changed. Row-specific explanations continue to name the member in
the currently edited values. Unknown blocking server problems retain the generic fallback.

## Regression evidence

The quick-fix wording-variation test failed before implementation: rewording payer and Tag
Needs left both in `stillNeeds`. It now covers them by meaning, leaves the date, and proves
that explicitly completing the correction produces Ready. Shared amount-targeting tests
vary displayed wording independently of missing/invalid total and payer/split decimals.
Android's existing controller/rendered tests cover corrections, totals, duplicate
acknowledgement and recovery. The browser regression selects payer and Tag chips, checks
the Ready live announcement, and confirms that neither chip implicitly records an Expense.

The existing duplicate-payer assistant explanation incorrectly describes supplied invalid
payers as omitted. Saving remains blocked. This behavior is preserved and separately
tracked in [#716](https://github.com/FireBird1998/splitbook/issues/716), as #709 requires.

Standards and spec reviews found no actionable issues.

## Verification

- `pnpm swarm gate --mongo-port 27712`: all 18 steps pass; 5,728 unit tests,
  lint, typecheck, formatting, ceilings and every mobile HTTP verifier.
- Web integration: 648 cases passed in the full run. Three CLI cases initially failed
  because this machine's global pnpm launcher is broken; all 14 CLI cases passed with a
  temporary Corepack PATH shim. The standalone file requires its own explicit MongoDB
  target; its two cases passed on a separate standalone container. All 653 integration
  cases are covered across that run and the targeted reruns.
- `CI=1 EXPENSE_ACCESS_MONGO_PORT=27712 pnpm web test:expense-access to-review-recovery.spec.ts`:
  all four browser checks pass against an isolated production build. The development run's
  first save-recovery check exceeded its assertion timeout while compiling the save route;
  no test timeout or production code was changed to obtain the passing production run.
- Focused shared (61), Android (139) and web rendered-guidance (19) checks pass.

All database checks used dedicated fictional-data MongoDB instances. The gate and browser
harness stopped their own apps and dropped their own databases.
