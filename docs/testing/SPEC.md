# Spec: a pull-request gate for the ledger

Synthesized from `docs/testing/AUDIT.md` and its workstream plan. This is the
body `to-spec` would publish. It stays a file in the repo; it was not filed
as a GitHub issue.

## Problem Statement

A maintainer can merge a change that splits an Expense wrong, states a
balance wrong, or records a Settlement twice, and the required pull-request
check stays green. That check runs unit tests and the Android HTTP
verifiers. The web integration suite (503 tests against Mongo) and every
browser suite wait for the nightly run, or for the `full-ci` label. A push
to `main` does not run them.

Locally, the same integration suite aborts when mongod's soft
file-descriptor limit is the default 1024. The failure then shows up as
30-second hook timeouts, which look like product failures. In the audit's
expense-access run, three browser tests failed twice: sign-out did not land
where the test says the Group cards and the stored payment attempt should
be gone, and Check again never appeared after an Unconfirmed save. Seven
other failures happened while the dev server was restarting for memory and
passed on retry. Split tests still accept a result that is merely close,
on top of an integer minor-unit implementation. The testing guide describes
an older, smaller suite, so the next person to add a test starts from the
wrong map.

## Solution

Ten workstreams, runnable together, make the existing suite the gate a
ledger can be sold on. The required check runs the web integration suite
on the Mongo replica and standalone that job already starts. The
integration suite finishes under a default mongod file-descriptor limit.
Shared money tests expect minor-unit literals, and the shared package
fails when a branch in those modules drops under a threshold. Routes that
today are only reached from a service call or a browser test gain an HTTP
test with a real session. The mocked balance tests go away. Browser money
journeys run once. The three expense-access tests that failed twice are
diagnosed before that suite is split. The testing guide matches the suite
that exists today. A failing Android verifier names the command and the
status or snapshot it saw.

None of the streams needs another's output. Production behaviour stays as
it is, except the shared money stream, which changes a function only when
a new literal expected value fails, and then stops.

## User Stories

1. As a maintainer, I want the required pull-request check to run the existing web integration suite against the Mongo replica and standalone that job already starts, so that a wrong balance cannot merge on a green check.
2. As a maintainer, I want that check to keep the name PR checks, so that branch protection does not have to be pointed at a new name.
3. As a maintainer, I want the browser suites to stay off the required check, so that every pull request pays for the integration seam and the nightly job keeps paying for the browsers.
4. As a maintainer, I want a merge to `main` to have already passed the integration suite on the pull request, so that the morning after a merge is not the first time the ledger is tested.
5. As a developer, I want `pnpm test` to finish when mongod has a soft file-descriptor limit of 1024, so that a red run means a product failure.
6. As a developer, I want the integration hook timeout left at 30 seconds, so that a hung database still fails in the open.
7. As a developer, I want the production Mongo connection pool left as it is, so that a cap added for the test driver cannot shrink the live server.
8. As a developer, I want the proof of that cap to be a full integration run against a mongod whose soft limit is 1024, so that the fix is demonstrated on the limit that aborted the audit.
9. As a member, I want a split asserted as an exact minor-unit amount, so that a one-minor-unit drift cannot pass as close enough.
10. As a member, I want web and Android to keep computing that split from the one shared module, so that the two clients cannot drift.
11. As a developer, I want the shared package test to fail when branch coverage of the money modules drops under a stated threshold, so that an uncovered remainder rule cannot hide behind a high statement percentage.
12. As a developer, I want each new money assertion added red, then green, so that a failing literal names the function to fix.
13. As a developer, I want production arithmetic left untouched when the new literals pass, so that the stream is a test change.
14. As a member, I want creating and reading a Group exercised over HTTP with a real session, so that membership is checked before the ledger is read.
15. As a member, I want an invitation to accept a member and reject an outsider, with the status and the error code asserted, so that joining is pinned at the HTTP seam.
16. As a member, I want an invite link to follow the same accept-and-reject rule, so that the link is not a second, untested door.
17. As a member, I want joining by code asserted over HTTP, so that an outsider cannot enter a Group by calling the service.
18. As a member, I want removing a member asserted over HTTP, so that the last-admin rule is visible at the route.
19. As a member, I want answering an invitation asserted over HTTP, so that accept and decline are not only true inside the service.
20. As a member, I want creating and retiring a Tag asserted over HTTP, so that a Tag's stable identity survives a rename at the route as well as in the model.
21. As a member, I want a partial Settlement to shrink what I owe by a literal minor-unit amount, so that settle-up and the balance agree.
22. As a member, I want that new balance read back through the balances route, so that the test sees what a member sees.
23. As a member, I want a Settlement from someone who is not in the Group rejected, so that only a member changes the ledger.
24. As a member, I want a second post of the same idempotency key to leave the Settlement recorded once, so that an Unconfirmed save cannot record twice.
25. As a member, I want an Expense Draft created over HTTP and left out of the ledger, so that a Draft stays unfinished information.
26. As a member, I want reviewing a Draft and saving it over HTTP, so that the ledger changes only when the member saves.
27. As a member, I want To review to list the Drafts waiting for me across my Groups, so that Finish later has an HTTP seam.
28. As a member, I want my profile read and updated over HTTP with my own session, so that one account's data stays on that account.
29. As a member, I want the recurring collection route asserted over HTTP, so that due recurring Expenses sit on the same gate as other ledger writes.
30. As a developer, I want balance behaviour proven against a real database, so that a query change does not fail a test whose balance is still right.
31. As a developer, I want any balance case that exists only behind a mocked model moved onto that real-database test with a literal expected balance, so that dropping the mock does not drop a behaviour.
32. As a developer, I want no new mock added while those balance tests move, so that the seam stays the database.
33. As a maintainer, I want the add-expense and record-payment browser journeys to run once, so that four theme projects do not repeat the same money path.
34. As a maintainer, I want theme and axe checks to stay on the theme matrix, so that chrome is still covered after the money journeys run once.
35. As a developer, I want a read-only demo spec to use more than one worker only when it does not write the shared demo database, so that parallel reads cannot corrupt a shared Group.
36. As a developer, I want the three expense-access tests that failed twice traced to the app or to the test, so that the sign-out landing and the missing Check again are fixed at the cause.
37. As a member, I want sign-out to clear the Group cards the browser test already looks for, so that the previous account's ledger leaves the screen.
38. As a member, I want sign-out to clear a stored payment attempt, so that the next account cannot see or retry it.
39. As a member, I want Check again to be present after an Unconfirmed save, so that I can retry a save whose reply never arrived.
40. As a member, I want that retry to reuse the same idempotency key, so that Check again records the save once.
41. As a developer, I want the five-second visibility timeout left where it is, so that a missing Check again stays a failure.
42. As a developer, I want the expense-access HTTP specs split from the browser specs, so that the HTTP files can run with more than one worker.
43. As a developer, I want each of those HTTP runs to keep its own database, so that parallel files cannot see each other's Expenses.
44. As a developer, I want browser specs that share a page to stay on one worker, so that a split does not interleave clicks.
45. As a developer, I want the testing guide to describe the suite that exists today, including the component tests that render static markup, so that the next test starts from the current layers.
46. As a developer, I want that guide to link the audit, so that the file counts and the CI split have a source.
47. As a developer, I want the guide to describe the suite before these streams land, so that it does not advertise tests that are not written yet.
48. As a developer, I want a failing Android verifier to print the command it ran and the HTTP status or snapshot it observed, so that a red outer seam can be read without a scavenger hunt.
49. As a developer, I want the 2,265 controller tests left as they are, so that the command-and-snapshot seam is not rewritten in this work.
50. As a developer, I want `pnpm test` to stay the Vitest suite, and the verifiers to keep a separate command, so that a live backend is not required for the unit run.
51. As an agent, I want each workstream to own a disjoint set of files, so that the ten streams can run at the same time.
52. As an agent, I want only the shared-money stream to edit the lockfile, so that adding the coverage dependency cannot collide with another stream.
53. As an agent, I want no stream to edit the audit, so that the measured numbers stay the record they are.
54. As an agent, I want no stream to rewrite a test it does not own, so that a green file stays green for a reason unrelated to that stream.
55. As a maintainer, I want the ten streams to have no ordering between them, so that they can land in any sequence.

## Implementation Decisions

The seams are the ones `CODING_STANDARDS.md` already names. Money stays one
pure module in `@splitbook/shared`, integer minor units, called by web and
Android (ADR 0002). Web ledger behaviour is tested over HTTP with a real
session. Android behaviour stays on the controller's commands and snapshot
(ADR 0004, ADR 0006). No stream adds a second implementation of the
arithmetic, a second client store, or a queued write.

Streams run in parallel. Each owns the files listed in the ownership map
below and nothing else. Only the shared-money stream adds a dependency, and
only that stream edits the lockfile. No stream edits the audit.

**PR gate.** The required check already starts a Mongo replica for the
Android verifiers and a standalone beside it. It also runs the existing web
integration command, with the replica URI and the standalone URI pointed at
those two servers. The check's name stays PR checks. Browser suites stay on
the nightly job and on the `full-ci` label. The stream edits the workflow
and does not edit a test.

**Integration load.** Integration file parallelism, or the test driver's
pool, is capped so a mongod with soft `nofile` 1024 finishes the web
integration command. The production pool is unchanged. The hook timeout
stays 30 seconds and the test timeout stays 20 seconds. The proof is that
same command against a mongod whose soft limit is 1024.

**Literal money.** Closeness assertions on split results become minor-unit
literals. Missing branch cases in the money modules are added one assertion
at a time, red then green. The shared package gains the v8 coverage
provider and a branch threshold for those modules only, enforced by that
package's test script. The measured baseline is 88% branches across the
shared package; the threshold covers the money modules, not a blanket over
every shared file. Production arithmetic changes only when a new literal
fails, and the change stops at that function. Web and mobile coverage stays
unmeasured.

**Group and membership HTTP.** New tests only, beside the routes for Group
create and read, the Group item, invite, invite link, join by code, member
removal, invitation answer, and Tags. Each test signs in for real, sends
the HTTP request, and asserts the status, the error code, and one literal
outcome: a member can join, an outsider cannot. The Group service is not
mocked. A Group delete follows the transaction fence in ADR 0007. Tag cases
keep the Tag's stable identity when the name changes (ADR 0009).

**Settle-up, Drafts, and profile HTTP.** New tests only, disjoint from the
Group stream. They cover the Settlement route, the Draft collection and the
single-Draft, review, and save routes, To review, profile, and the
recurring collection route. The existing recurring-item test is left alone.
The Settlement test shows a partial payment shrinking the balance by a
literal minor-unit amount, a non-participant rejected, and a second post of
the same idempotency key leaving one Settlement. The balance is read back
through the balances route. A Draft save is the member's save (ADR 0008);
the test shows the ledger unchanged until that save, and a retry of an
Unconfirmed save recorded once. These routes use a transaction where the
product already does, so the tests run against a replica set.

**Balances.** Assertions that mock the Expense, Settlement, and Group
models are deleted. A case that exists there and nowhere else moves onto
the real-database balance test, with a literal expected balance. No new
mock is added. Balances follow Expense reads, including due recurring
Expenses, as the standards already require.

**Demo browser.** Money journeys (add an Expense, record a payment, the
demo journeys) run once. Theme and axe stay on the light/dark and
desktop/mobile matrix. A read-only spec may use more than one worker only
when it does not write the shared demo database. Assertions stay as strict
as they are. The expense-access suite is outside this stream.

**Expense-access.** The first change is diagnosis of the three tests that
failed twice in the audit: sign-out clearing Group cards (the URL became
the origin), sign-out clearing a stored payment attempt (the URL became
the login page with a callback), and Check again after a lost single save
reply (the button was not visible within five seconds). The five-second
timeout stays. The settlement test already allows 30 seconds for a
dev-server compile, and that allowance is not widened. After the diagnosis,
HTTP specs are split from browser specs so the HTTP files can run with more
than one worker. Each run already has its own database. Browser specs that
share a page stay at one worker. The demo browser directory is outside this
stream.

**Testing guide.** The guide replaces the claim that a component test is
not collected, and replaces the old layer table, with the file counts and
the CI split in the audit. It links the audit. It describes the suite as
it is today.

**Android verifiers.** A failing verifier prints the command and the HTTP
status or snapshot it observed. The controller tests stay. The workflow and
the local gate stay. `pnpm test` stays Vitest. The verifiers keep a
separate command because they need a live backend.

## Testing Decisions

A good test exercises the seam a member or a caller actually crosses, and
asserts a literal outcome. It does not recompute the expected value, and
it does not mock a module this repo owns. A mock is for the network edge,
and for the session only when a route cannot be driven through a real
sign-in. These routes can.

The modules under test are the ones the audit found thin or coupled:

- The shared money modules, at the pure-function seam, with prior art in
  the existing shared unit tests. Expected amounts become literals. The
  branch threshold is new; the assertions follow the red-then-green rule
  in the `tdd` skill.
- Group, invitation, Tag, Settlement, Draft, To review, profile, and
  recurring collection routes, at the HTTP seam. Prior art is the
  expense-access suite's real session, and the route integration tests
  that already post through the handler. New tests prefer the HTTP call
  over calling the handler in process.
- Balances, at the existing real-database integration. Prior art is that
  integration file: zero-sum, a Settlement shrinking a debt, per-currency
  dashboard buckets, legacy mixed currency, archived trips. The mocked
  service test is the case to retire.
- Demo browser journeys, at the Playwright seam, for navigation and chrome
  that a single HTTP call cannot show. Prior art is the current demo
  projects; money journeys leave the four-way matrix.
- Expense-access, at the same Playwright seam, starting from the three
  tests that failed twice. Prior art is the rest of that suite, which
  passed.
- Android verifiers, at the outer HTTP seam. Prior art is the verifier
  scripts the pull-request check already runs. The inner seam stays the
  controller tests, which this spec does not change.

One seam per surface is the goal. The shared package is the money seam.
HTTP is the web seam. The controller is the Android seam. Browser tests
cover only what those three cannot see.

## Out of Scope

- Filing this spec as a GitHub issue, or applying a triage label. The
  owner files tickets.
- Implementing any of the streams in the change that adds this spec.
- Running `/setup-matt-pocock-skills`. The tracker docs already exist.
- Installing any further Matt Pocock skill. `to-spec` is vendored alongside
  `tdd`, `codebase-design`, `code-review`, and `setup-matt-pocock-skills`.
- Putting a Playwright suite on every pull request.
- Raising the hook timeout, the test timeout, or the five-second browser
  visibility timeout to absorb a failure.
- Changing the production Mongo pool.
- Editing production money code when the new literals pass.
- Rewriting passing controller tests, seed tests, or the golden JSON
  contract tests.
- Running, as part of this spec, the demo browser suite, the Google
  sign-in suite, the pilot, or the Android verifiers. The audit records
  what was actually executed.
- Measuring web or mobile coverage, or setting a coverage threshold
  outside the shared money modules.
- Adding a component-interaction runner. Component tests stay static
  markup. Clicks stay in the browser suites.
- Contacting Google. The eight Google sign-in tests stay off the required
  check.
- Editing the audit from any stream.

## Further Notes

Two steps of `to-spec` were not carried out. The skill says to check the
seams with the user before writing; the same skill also says not to
interview, the audit already fixed the seams above, and this run does not
pause for a confirmation. The skill then says to publish the spec to the
issue tracker and apply `ready-for-agent`. The owner forbade GitHub issues
and tracker publication, so the spec is this file.

The ownership map is the coordination contract. Paths are kept here, and
out of the decisions above, because the skill treats paths in the decision
list as the part that goes stale. If a path moves, the audit's plan section
is the source.

| Stream                     | Owns                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR gate                    | `.github/workflows/ci.yml` only.                                                                                                                                                                                               |
| Integration load           | `apps/web/vitest.config.ts` and `apps/web/src/lib/test-utils/integration-db.ts` only.                                                                                                                                          |
| Literal money              | `packages/shared/package.json`, `pnpm-lock.yaml`, `packages/shared/vitest.config.ts`, and the shared tests `exact-money`, `split-calculation`, `debt-simplifier`, `expense-split`, `settlement-preview`, and `dashboard` only. |
| Group and membership HTTP  | New files only: Group collection and item, invite, invite link, join by code, member removal, invitation answer, and both Tag routes under `apps/web/src/app/api/`.                                                            |
| Settle-up, Drafts, profile | New files only: the Settlement route, the Draft collection plus its item, review, and save routes, To review, profile, and the recurring collection route. Leave the existing recurring-item integration test alone.           |
| Balances                   | `apps/web/src/lib/services/balance.service.test.ts` and, only for a case that exists nowhere else, `apps/web/src/lib/services/balance-integrity.integration.test.ts`.                                                          |
| Demo browser               | `apps/web/playwright.config.ts` and `apps/web/playwright/**` only.                                                                                                                                                             |
| Expense-access             | `apps/web/playwright-expense-access/**` and `apps/web/playwright.expense-access.config.ts` only.                                                                                                                               |
| Testing guide              | `docs/testing.md` only.                                                                                                                                                                                                        |
| Android verifiers          | `apps/mobile/scripts/verify-*.ts` and `apps/mobile/scripts/verify-all.mjs` only.                                                                                                                                               |

The three expense-access failures to diagnose first, by the names the audit
recorded:

- Sign-out clears Group cards. The test expected the dashboard URL and
  received the origin.
- Sign-out removes every stored payment attempt. The test expected the
  origin and received the login page with a callback back to the Group's
  balances.
- Check again after a lost single save reply. The button named Check again
  was not visible within five seconds.

Seven other expense-access failures in that run passed on an immediate
retry while the dev server was restarting for memory. They are not the
diagnosis list. Playwright will not mark them flaky: that config does not
retry. The demo config retries once in CI, which can hide the same class
of miss; this spec does not turn that retry off, and it does not add a
retry to expense-access.
