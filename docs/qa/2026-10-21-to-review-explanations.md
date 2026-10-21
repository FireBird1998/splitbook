# To review repeated explanations by meaning — #713

Completes spec #709 after #712/#717, against merge commit `ee2e03dc`.
#717 was already merged when implementation started; its final head passed full CI. The
merged Theme naming cleanup is preserved.

## Meaning and rendering

Both clients continue to call the shared `memberProblems` interface. Incoming legacy server
problems are interpreted once into an explanation and the semantic needs that cover it.
Suppression compares field, reason and precision; repeated explanations are identified
before rendering. Member-row explanations remain separate from broader field needs and
resolve the person from the current edited values. Existing identical member-name and
fallback-name deduplication is preserved using those domain facts, without comparing
rendered sentences. Unknown problems have no covering need, retain the safe generic
explanation and remain blocking.

## Caller audit

Removed all three Needs-text recognition paths in `memberProblems`, rendered-sentence
comparison for repeated explanations, the enumeration of every Theme's currency words,
`codeNeeds`, `codeNeedWords`, `unmetNeed` and obsolete exported wording constants. Removed
Android's `Amount needed` comparison for suppressing a second missing-amount label. Web
panel completeness and Android review blocking now consult semantic needs directly.

`missingFacts`, `unknownFacts` and `label` remain derived display projections because callers
render them; they are no longer inputs to field targeting, coverage or repeated-explanation
decisions. `unknownFacts` still renders the web assistant explanation. Intentional client
presentation differences and the separately tracked #716 inconsistency are preserved.

Retained legacy interpretation is concentrated in `problemPath`, `validationNeed` and
`readReviewProblem`: known validation paths/reasons, decimal limits, existing server codes,
and the allowlist of safe action messages. Category-to-Tag suggestions still match Tag
names; those are domain facts, not interpretation of guidance wording. Server responses,
stored Drafts, possible duplicate detection, acknowledgement, conflict handling and save/
retry mechanisms are unchanged.

## Red/green evidence

- Rewording a missing-payer Needs line reproduced an extra `Who paid?` before the change.
- Reworded decimal, split, payer and percentage needs each reproduced a repeated sentence.
- Reworded Trip, Household and generic Group currency needs each reproduced the additional
  `Choose the Group currency.` sentence.
- The actual web panel currency-copy regression fails against `ee2e03dc` and passes with
  semantic suppression. A separate panel test keeps a missing need blocking independently
  of an empty display projection.
- Row and unknown-problem checks preserve current edited member names, one row explanation
  beside a broader field need, safe generic fallback, and blocking status.
- A temporary compatibility probe passed 5,544 comparisons with the merged baseline across
  legacy messages, Draft states, row cases and duplicate/fallback member names. It caught a
  legacy decimal reason filed outside the amount/payer/share fields; a focused regression
  preserves its existing amount meaning. The probe and its scratch source are outside the
  committed change.

The added browser interaction checks that a payer-row explanation appears once while its
broader payer need is present, disappears after the amount is corrected, and only then
allows explicit Save. Existing quick-fix, lost-reply, typing and offline journeys remain.

## Review and verification

Standards review: 0 findings. Spec review: 0 findings, against `ee2e03dc`.

- `pnpm swarm gate --mongo-port 27714`: all 18 steps pass in 420.4 seconds,
  including 5,757 unit tests, lint, typecheck, formatting, ceilings and every mobile HTTP
  verifier. The gate stopped its own app and dropped its database.
- Web integration: 650 cases passed in the full run. Three activity/seed cases reported
  database timeouts while database-heavy checks overlapped. Both affected files then passed
  all 24 checks with one worker and no overlapping browser work. All 653 integration cases
  are covered across the full run and targeted rerun. Dedicated replica-set and standalone
  MongoDB targets and the external Corepack PATH shim were used; no product/test timeout
  or configuration was changed.
- The five To review browser checks pass against an isolated production build, including
  the added payer-row correction and existing quick-fix, lost-reply, typing and offline
  behavior. The overlapping first run passed four but timed out in single-save recovery;
  the separate rerun passes all five without code or timeout changes.
- Focused shared (72), Android (141) and web panel (14) checks pass.

All database data was fictional and isolated. The browser harness stopped its own app and
removed its database. Raw logs and the compatibility probe are outside the commit.
