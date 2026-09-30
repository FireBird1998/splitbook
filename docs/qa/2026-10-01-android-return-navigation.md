# Android Expense return, draft recovery and history (#104)

This change implements [#104](https://github.com/FireBird1998/splitbook/issues/104) under specification [#99](https://github.com/FireBird1998/splitbook/issues/99), with the navigation and snackbar decisions from [#112](https://github.com/FireBird1998/splitbook/issues/112), starting from `main` at `eb9cd92`. It is **not** a complete #104: the Group bottom-navigation destination depends on [#115](https://github.com/FireBird1998/splitbook/issues/115), and no installed-Android check was possible here (see [Not verified](#not-verified)).

## Behaviour

- **Return context.** Opening an Expense from a Group's view records its Group, Month and scroll offset (`snapshot.expense.returnTo`). Retry, Discard and "Keep current saved record" reopen the same task and keep it.
- **Back and close.** Android Back and the top-bar arrow ("Back to Group") keep the draft on the device and return to that Group and Month. The view restores its scroll position once its content is laid out. A drag or a Month change cancels the restore.
- **Page range.** The return context also records how many Expense pages were loaded (`pages`).
  - The Group's next Expense read after a return reads that same range, so an Expense opened from page 2 or later is still listed.
  - The range is published once, so the list never shrinks while the position is restored.
  - If a later page fails for any reason other than denial, the pages read are kept and Load more is offered.
  - Ordinary refreshes still start from the first page. This was added after independent review found that a return kept only the first page.
- **Other exits.**
  - Back first dismisses a delete confirmation.
  - Direct entry, with no known origin, returns to the Group at its default Month (the current Month for a Household).
  - A Group removed after denial returns Home.
- **Save.** A confirmed create, edit or delete returns the same way and shows the compact Snackbar ("Expense saved · Weekly groceries").
  - When the Expense belongs to a Month other than the one shown, the Month stays and the Snackbar offers "View in {Month}". The year is added when it differs.
  - The Month changes only when the member chooses it.
  - Returns go through `refreshLedgerViews`, so #137's post-write invalidation still applies.
- **Late completion.** A save that completes after navigation, a Group change or sign-out never navigates, changes Month or shows the Snackbar.
- **Draft resume.**
  - Resuming an ordinary draft clears the resume notice and keeps every entry.
  - The prompt uses an info Banner for an ordinary draft ("Unfinished draft · Nothing has been sent").
  - A save that may already be recorded uses a warning Banner ("Save not confirmed") and offers no Discard.
- **Uncertain-save recovery** is unchanged. An explicit retry resends the stored body with the same submission key; edits keep their original revision. Reopening, foreground refresh, reconnecting and restart send nothing.
- **Edit history** names people, falling back to "Former member". Amounts use the currency each edit was made in, and dates, categories, Tags, split methods and per-person amounts are described in words. Raw JSON, member references, Tag references and receipt URLs are never shown.
  - Each line has a spoken form, for example "Amount changed from ₹8.99 to ₹10.00".
  - The formatter is `describeExpenseHistory` in `apps/mobile/src/data/expense-history.ts`.

## Automated verification

- **Mobile:** 319 tests. New:
  - `expense-return-controller.test.ts` (19): public-controller journeys against a fictional ledger that paginates like the backend, commits a create before losing its response, deduplicates by `Idempotency-Key` and enforces `If-Match` revisions. Three cover a return beyond the first page: Back, an edit and a new save, and a failing later page. All three fail on the first reviewed head, `52e2c27`.
  - `expense-history.test.ts` (5): the formatter's rules.
  - Rendered editor tests (3): ordinary versus unconfirmed resume, and readable history.
  - Rendered App tests (4): Android Back with Month and scroll, the back arrow, and same-Month and other-Month saves with "View in August".
- **Checked against `main`:**
  - 18 of the 19 controller journeys fail on `main`. Three of those, the late-completion guards, fail only because `snackbar` and `restoreScroll` do not exist there.
  - "Never leaves while a save is being sent" passes on both.
  - All 7 new rendered tests fail on `main`.
- **Other packages:** shared 268 and web unit 139. Workspace typecheck, lint and `prettier --check .` pass.
- **Timezones:** the new suites pass with `TZ` set to UTC, America/Los_Angeles, Pacific/Honolulu, Asia/Kolkata, Pacific/Auckland and Pacific/Kiritimati.

## Real backend, public controller

**Environment:**

- Backend: this branch's `apps/web` (Next 16.1.6 dev server) through `apps/mobile/scripts/dev-backend`, on `127.0.0.1:4138`, with fictional personas only.
- Database: MongoDB 7.0.43 (`mongo@sha256:9854f713…`) in a throwaway container, database `splitbook_mobile_50`.
- Runtime: Node 22.22.0, `TZ=Asia/Kolkata`.

**Existing verifiers, rerun unchanged and all passing:** `verify:expenses`, `verify:expense-edit` and `verify:offline`.

**#104 journey.** A one-off script, not committed, drove the real controller with disk-backed draft storage in a run-owned fictional Household, then archived it:

- Back from a new Expense returned to the previous Month at scroll 480, with no write.
- After a restart, Resume kept every entry. An invalid `12.505` was corrected locally, with no write.
- The created Expense's response was lost after commit. After that, Back, a foreground refresh, a restart and reopening sent nothing. The explicit retry reused the same key and body, and exactly one Expense existed afterwards.
- A save dated in the current Month, made from the previous Month, stayed on the previous Month and offered "View in". Choosing it showed the saved Expense.
- Editing it back into the previous Month returned to the origin Month and offered the other Month.
- The server's own `editHistory` read:

  ```text
  Alex Rivera changed the amount, the date, who paid and the split
  Amount: ₹12.50 → ₹14.00
  Date: Oct 1, 2026 → Sep 28, 2026
  Alex Rivera’s payment: ₹12.50 → ₹14.00
  Alex Rivera’s share: ₹6.25 → ₹7.00
  Sam Chen’s share: ₹6.25 → ₹7.00
  ```

## Integration with #137

A throwaway merge of #137 (`feat/android-cached-reads` at `58787d7`) into this branch conflicts in `back()` and twice in `readExpenses`. The resolution:

- **`back()`:** keep `closeExpense()`/`showHome()`, and have `showHome` call #137's `loadHome(true)`.
- **`readExpenses`:**
  - Decide the return's page target (`through`) before #137's fresh-first-page shortcut, and take that shortcut only when `through === 1`.
  - Keep #137's first-page read with `wanted` and its saved-copy preview. Then read the remaining pages with this branch's loop, passing `wanted` to `readCached`.

With that, the 336 mobile tests of both branches, typecheck and lint pass together. Without the `through === 1` condition, two page-range tests fail: #137 would publish only a reused first page. Back from an Expense on its first page still reuses #137's recent reads, and confirmed saves still invalidate and re-read.

## Not verified

- **Installed Android.** This cloud environment has no Android SDK, ADB or `/dev/kvm`, and no shared emulator is reachable from it. No APK was built or installed, and nothing was checked on an emulator or phone:
  - Back, predictive Back and the arrow
  - scroll restoration timing on real layout events
  - Snackbar placement, contrast and dismissal (it uses Android's accessibility timeout: 10 s with an action, 6 s without)
  - restart, response loss and correction on the device
- **Accessibility and display.** TalkBack, large text, dark mode and 360 × 640 were not checked. Rendered tests assert roles, labels and live regions only.
- **#115 destination.** Restoring the Expenses, Balances or Activity destination is not implemented; the Group view has one scrollable page until #115 adds destination state. The proposed contract is on #115.
- **Activity details.** They still show member and Expense references and raw snapshots. Plain-language Activity edits belong to #115, which can reuse `describeExpenseHistory`.
- **Per-Expense history.** The history endpoint belongs to #129. This change formats the history already embedded in each Expense record.
