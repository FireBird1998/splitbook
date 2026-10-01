# Validated remaining work and agent handoff

Checked 29 September 2026 against local/GitHub main `9c6de8e823008b7c5237164349fd8a56dd4848b0`. No open PRs. Main CI passed: https://github.com/FireBird1998/splitbook/actions/runs/36557536483. This is a source/tracker/evidence audit, not a fresh production audit or full regression run. No issues, credentials, or production resources were changed.

Repository: https://github.com/FireBird1998/splitbook

## Recommended order

### 1. Complete the Expense verification handoff, then ledger work

**First reconcile #66–70; do not reimplement them.** The money-edit/draft implementation is already on main. `docs/qa/2026-09-28-expense-module-depth.md` records its acceptance evidence; `docs/qa/2026-09-28-expense-independent-review.md` records independent review. The latter's pending-CI limitation is historical: current main CI is green. Verify each acceptance criterion, attach the accepted revision and evidence, then close only the satisfied implementation tickets. Preserve parent #65. #70 currently remains open with no completion comment, so #77's explicit gate is not yet satisfied.

**Then #77 → #78 → #79 under parent #73. All three are valid.**

- #77: characterize both writers' retry/failure behavior through real authenticated app/Mongo interfaces, including concurrency, mismatched requests, departed participants, historical Tags, unrelated duplicate-key failures, postcommit response failure, and Activity recovery. Reuse existing coverage; add only missing cases.
- #78: correct Activity-before-response ordering and consolidate retry coordination only if it genuinely simplifies the two callers. Current fresh Settlement creation still populates the response before `publishPending` in `apps/web/src/lib/services/settlement.service.ts`; normal replay/collision paths already publish first. A postcommit response failure can therefore postpone the first Activity attempt. Pending intent is durable; this is not evidence of a duplicate financial effect or lost ledger data. Preserve distinct Expense/Settlement authorization and retry policies. Retaining explicit writers is an allowed outcome; the ordering fix and tests remain required.
- #79: verify final financial and recovery journeys, exact-money/access/recurring regressions, applicable browser/a11y checks, workspace checks and build. Record exact commit, results and limits. Preserve parents #65/#73 and attached plans.

### 2. Production data/auth launch — valid, but reconcile the older instructions first

Tickets #9, #10, #33 and #11 remain valid operational acceptance work. Local real Google login was verified in `docs/qa/2026-09-27-local-google-auth.md`; that does not prove production sign-in or Atlas cutover. Current production settings/data have not been re-audited in this pass.

Recommended sequence: inspect deployed app, database and existing configuration read-only; reconcile #9 and #33; verify/provision the chosen data target; configure/verify production OAuth under #10; perform Better Auth cutover verification under #33; finish full live product smoke under #11.

Corrections required before execution:

- #9/#10 contain obsolete Auth.js wording. Better Auth is already the implementation. Keep the actual callback contract `/api/auth/callback/google` and use current auth configuration.
- #9 requests a fresh empty database while #33 assumes migration of existing Auth.js users. Inspect the actual chosen database first. Do not blindly migrate an empty database or reset existing user data to satisfy both tickets.
- Production migration, secret rotation, alias changes and destructive cleanup require a concrete reviewed rollout using the actual environment; do not infer credentials/configuration from local demo files.
- If an acceptance criterion is already satisfied, record evidence instead of redoing provisioning. Do not print secrets or copy local credentials into production by assumption.

These can remain deferred while the user prioritizes local full-stack development.

### 3. Native Google sign-in — #35 then #36

Still valid: server auth currently has only the web Google client ID, web trusted origin and no Expo server plugin. Native runtime still uses its current explicit cookie/SecureStore adapter.

Update the exact environment identifiers before creating OAuth clients. `apps/mobile/app.config.ts` uses `com.splitbook.app.dev`, `com.splitbook.app.staging`, and `com.splitbook.app`, with matching distinct schemes. #35 only mentions `com.splitbook.app`; provisioning that alone does not satisfy the signed staging build in #60. Match the chosen Android package and certificate fingerprints, callback scheme and server token audience. iOS work is not an Android release prerequisite unless that platform is also being targeted.

Implement #36 against the installed Better Auth/Expo versions and existing account-cleanup/session contract. Preserve environment/account isolation, invitation continuation, sign-out cleanup, allowlisting and recovery. Verify real native Google behavior separately from synthetic token tests. Do not blindly add a second competing cookie/session implementation.

### 4. Signed staging Android release — #60

Valid and unfinished. The feature blockers #48, #52, #55, #56, #58 and #59 are closed; real native auth #35/#36 is still open. Deliver a reproducible signed APK, separate staging ledger, no demo entry in the distributed build, approved/denied real Google account checks, session/restart/invitation/sign-out flows and a complete financial smoke journey. Existing development APK/emulator evidence is not this release evidence. Store publication and iOS release are outside #60.

### 5. Optional later cleanup — #34

Do not start now. Its own condition is a verified production cutover followed by one week. First establish whether legacy backup collections or obsolete variables actually exist. Preserve/export recoverable data and obtain explicit approval before destructive production deletion. If nothing exists, close with evidence rather than manufacture cleanup work.

## Completed work whose issue state is stale

- #17–19: Group-scoped Expense read/edit/restore/delete protection is on main (`5ebfc3a`, followed by `14a7e71`) and covered by authenticated access tests. Check each criterion, then record completion and close the children; do not build a replacement authorization layer.
- #66–70: Expense money-edit/draft work is on main (`a482382`, `c9f6ca5`, subsequent verification), as described above. #70's evidence handoff is needed to unlock #77.
- #15, #16, #26, #39, #49, #65, #72, #73 and #3 are parent/specification issues. They are not nine separate coding defects. Some have completed implementation children; others own the pending release/ledger work. Do not mass-close or rewrite parent specs; several explicitly require remaining open.
- Design-system expansion beyond the approved pilot, backups, OCR integration, custom domains and other later items in #3 are deferred roadmap work, not unresolved findings from the reviewed PRs.

## Starter prompt for the next agent — recommended first assignment

Work on FireBird1998/splitbook. Start from current verified origin/main in an isolated checkout and read AGENTS.md, CONTEXT.md, the applicable ADRs, issues #65–70 and #73/#77–79. Preserve the user's dirty primary checkout, plans, environment files and persistent MongoDB; no production work is included.

First reconcile the already-merged Expense implementation #66–70. Read the committed Expense QA report, inspect the current implementation and tests, and check current CI. The local independent review report is additional evidence, not a substitute for the acceptance criteria. Fill any actual verification gaps. Record the accepted commit, commands/results and limitations on the relevant implementation issues and close only those whose criteria are satisfied. Keep parent #65 open and unmodified. Do not bypass #70 while it remains unresolved.

After #70 is completed, implement #77, then #78, then #79 in dependency order under the approved #73 spec. Characterize behavior before refactoring. Preserve the writer-specific authorization, participant/Tag rules, immutable scoped fingerprints, currency locks, atomic pending Activity intent, duplicate-key recovery and unkeyed compatibility. Ensure fresh creation, replay and collision recovery attempt bounded Activity publication before response preparation. Keep two explicit creation operations; do not force a generic callback-heavy writer. If consolidation does not improve the interface, retain explicit writers and document the justified decision while delivering the ordering fix and tests.

Use an isolated real app/database for HTTP and financial recovery tests; keep necessary browser lost-response journeys. Test postcommit response failures and Activity outages through isolated infrastructure seams, never production fault routes. Run relevant full regressions, workspace quality checks and builds on the final revision. Report failures honestly, do not weaken assertions or overwrite visual baselines without inspection. Provide separate Standards/Spec review results, exact tested SHA, QA evidence and remaining limits. Distinguish simulated Google tests from real-provider verification.

Open reviewable PRs in dependency order, attach each PR to the task, and stop before merging for independent QA. Do not change production auth/Atlas, implement native OAuth, distribute an APK, or modify/close parent specifications in this assignment.
