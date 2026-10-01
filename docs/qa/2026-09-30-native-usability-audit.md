# Android expense and refresh usability audit

Audit started 30 September and completed after midnight on 1 October 2026, India time.

The Android beta rejects invalid financial input, but its guidance does not reliably explain how to correct it. Refresh also replaces usable content with loading states. These are confirmed usability defects, despite passing controller tests. Prioritize correction before treating the beta as ready for everyday use.

## Scope and evidence

Requested after a physical-phone report of an unexplained Expense save failure and repeated loaders. Inspected the staging implementation at `eaf8b11cddb1a2ea30263e6a8a38aac56c8b13a7` in the `pr81-merge` worktree. This audit does not change application code, deploy, merge, or create ledger records.

The existing signed APK was restored to the emulator. Its SHA256 is `b44f473831faa4bed67f99f74a4dbd2b100761ba3443df9f4e7daee8047a8b12`. The restarted emulator initially had only the development app installed and no staging login. The user subsequently signed in, enabling the fresh native checks below. No valid Expense or Settlement was submitted in this pass.

Sources below refer to the reviewed revision, which may differ from the main checkout containing this report. Line numbers are approximate anchors at that revision.

## Confirmed findings

| Priority | Finding                                                           | Evidence and user impact                                                                                                                                                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2       | Required Description is undiscoverable and its correction is lost | `expense-editor.tsx:251` says only “Description”; only Tag explicitly says required. Shared schema requires nonblank trimmed Description. `saveExpense` converts its Zod error to “Check the amount, date, participants, currency, and active Tag,” omitting Description. A temporary controller probe reproduced this for empty and whitespace-only values. |
| P2       | Create and edit report the same invalid field differently         | A blank edited Description produces serialized validation details including `code` and `path`; the new-Expense case produces a generic message. Confirmed by a separate controller probe. `saveExpenseEdit` forwards `Error.message`, while creation handles only selected error classes.                                                                    |
| P2       | Refresh erases already loaded financial content                   | `refreshHome:819`, `openGroup:983`, `beginExpenseRead:1170`, and `readExpenses:1184` reset content before requests complete. A same-Group refresh probe observes ready balances becoming null and expenses/balances simultaneously loading.                                                                                                                  |
| P2       | Automatic refresh activates multiple progress indicators          | `App.tsx:111` derives native pull-refresh state from all relevant reads; `financial-views.tsx` renders section loaders too. `AppState` refreshes on every transition to active. Code explains overlapping loaders; an endless periodic loop has not been reproduced.                                                                                         |
| P2       | Overlapping refreshes are not coalesced                           | Two concurrent `controller.refresh()` calls dispatch two Group reads in a deterministic probe. Request counters reject obsolete results, but do not avoid both requests.                                                                                                                                                                                     |
| P2       | Basic input validation waits for a network check                  | `saveExpense:2003` fetches Group context before `buildExpenseBody`. Invalid Description/date can encounter network delay or failure before receiving any useful input feedback. Local required-field checks should precede that check; authorized live context is still required before writing.                                                             |
| P3       | Form feedback has no reusable field-error presentation            | Shared `Field` in `group-workflows.tsx:31` provides label/hint but no error presentation or focus API. Expense error is near the bottom (`expense-editor.tsx:385`); no first-invalid-field scroll/focus behavior is wired. This is code-confirmed, with fresh TalkBack/keyboard checks pending.                                                              |
| P3       | Recovery and history expose confusing implementation detail       | `resumeExpenseDraft` changes status without clearing the resume warning. `ExpenseRecordView:82` prints raw JSON changes. These corroborate earlier emulator observations; no fresh authenticated visual retest in this pass.                                                                                                                                 |

## Reproduction recipes

### Missing Description

1. Open a new Expense in an authorized test Group.
2. Enter a valid amount, retain valid payer/participants/date, and select an active Tag.
3. Leave Description empty, then submit. Repeat with whitespace only.
4. Actual controller outcome: no Expense POST, draft retained, editing remains available, but message does not mention Description. The field label has no required marker.
5. Desired outcome: “Add a description, such as Groceries,” associated with Description; scroll/focus it without losing any entries. No network call should be needed to identify this local omission.

### Blank Description when editing

1. Open a saved Expense, choose Edit, and clear Description.
2. Save changes.
3. Actual controller outcome: no PATCH, draft retained, serialized Zod validation details exposed through the message.
4. Desired outcome: the same concise field error as creation.

### Refresh resets and duplicate reads

1. Sign in and load a Group completely.
2. Subscribe to controller snapshots; call refresh again.
3. Actual: previously ready balance data becomes null; both financial sections enter loading.
4. Call refresh twice before completion. Actual: two reads of the same Group are dispatched.
5. Desired: retain only matching authorized content, one in-flight read per resource, distinguish manual and background refresh, and publish ordered fresh results.

## Verification performed

Existing tests were run serially by file group, without repeating the same suites:

- Expense, financial views, offline, Settlement, Activity: 123 passed across five files.
- General controller, configuration, cookies, invitation links, appearance: 72 passed across five files.
- Google session and identity: 19 passed across two files. Total existing mobile tests: **214 passed across 12 files**.
- Eight temporary characterization cases passed by asserting the current defective behavior: blank/whitespace Description, invalid date, excess amount precision, missing Tag, refresh resets, duplicate refresh reads, and raw edit validation errors. They are diagnosis evidence, not regression tests asserting the desired fix.

The existing invalid-input test checks that the message is merely truthy. It does not assert field identity, understandable copy, focus, keyboard visibility, accessibility, or navigation. That is why the test suite can pass while the phone flow is confusing.

Logs and temporary probe sources:

- `/tmp/splitbook-ux-qa-tests.log`
- `/tmp/splitbook-ux-qa-other-tests.log`
- `/tmp/splitbook-ux-qa-auth-tests.log`
- `/tmp/splitbook-ux-characterization.log`
- `/tmp/splitbook-ux-edit-characterization.log`
- `/tmp/splitbook-ux-characterization.test.ts`
- `/tmp/splitbook-ux-edit-characterization.test.ts`

The temporary files were removed from the source worktree after execution. An unrelated existing untracked route test was preserved. No application fix is included in this audit.

## Fresh emulator observations

On the signed staging APK, opened the existing one-member Test Group and a new empty Expense draft. Entered `10`, chose General Tag, retained the default date, payer and participant, and submitted with blank Description. The form first showed “Saving expense…” while it checked context, then the generic error named amount/date/participants/currency/Tag but omitted Description. Scroll position stayed at the bottom; the Description field remained off-screen. Returning to the field showed no inline error or required marker. Amount and selected Tag survived.

Corrected Description to `QAValidation` and changed Amount to `10.001`. The allocation panel correctly explained that Amount supports at most two decimal places, but the feedback was separated from the Amount input. After force-stop and relaunch, the session remained signed in. Reopening the Group and Add Expense offered Resume draft with `10.001`, `QAValidation`, and the original date intact. Removed only this newly created QA draft through the confirmation dialog after verification; no valid financial submission was made.

Evidence: [initial field labels](evidence/2026-09-30-native-usability/required-labels.png), [missing Description error](evidence/2026-09-30-native-usability/missing-description-error.png), [precision feedback](evidence/2026-09-30-native-usability/precision-error.png), and [draft after restart](evidence/2026-09-30-native-usability/draft-restart.png). The missing-Description UI hierarchy was retained at `/tmp/splitbook-ux-missing-description-error.xml`.

## Coverage and remaining gates

| Journey                                                     | Evidence now                                               | Required next check                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Empty, whitespace, invalid date, precision, Tag             | Controller probes and existing tests                       | Native error placement, focus, keyboard and correction loop                        |
| Equal, exact, unequal, percentages, shares, multiple payers | Existing Expense controller suite                          | Two-person native entry, totals, understandable remaining amount                   |
| Edit, delete, conflict, lost response, idempotent retry     | Existing controller suite; prior live staging edit success | Fresh device recovery, invalid edit feedback, readable history                     |
| Draft restart and offline editing                           | Existing offline/Expense tests; earlier emulator pass      | Fresh build restart with an incomplete form and modal edits                        |
| Month miss offline and all-time balances                    | Existing offline/financial tests; earlier emulator pass    | No wrong-Month placeholder during refresh redesign                                 |
| Group creation, invitations, appearance, account cleanup    | Existing controller/configuration tests                    | Required Group name feedback, invite journey and font scaling                      |
| Settlement review, overpayment acknowledgement, retry       | Existing Settlement suite                                  | Real two-account authorized journey; this audit records no payment                 |
| Sign-in, revocation, account switching                      | Automated session/cache tests                              | Fresh approved/denied native Google login and device cache purge                   |
| Repeated loaders                                            | Controller snapshots and UI source                         | Screen recording plus request counts under slow network and repeated foregrounding |
| Accessibility and layout                                    | Source inspection only                                     | TalkBack, large text, small display, dark theme, keyboard overlap                  |

Passing automated checks do not establish complete physical-device QA. The fresh native tests above confirm the reported form defect; multi-account financial journeys, TalkBack and slow-network performance measurements remain open. See the [implementation plan](../plans/2026-09-30-native-usability-hardening.md) and [caching research](../research/2026-09-30-native-background-refresh.md).
