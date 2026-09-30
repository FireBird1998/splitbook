# Android Expense field corrections (#100)

This change implements [#100](https://github.com/FireBird1998/splitbook/issues/100) under specification [#99](https://github.com/FireBird1998/splitbook/issues/99), starting from `main` at `a5ae1c5`. It reuses the audit's reproduction ([native usability audit](2026-09-30-native-usability-audit.md), not in this branch): on `main`, a blank Description on a new Expense produced a generic message that omitted Description, while editing exposed serialized validation details.

## Behaviour

- Amount, Description, Date, Paid by, Split and Tag are labelled **Required**. Category and notes are described as optional.
- Each field shows its correction directly below it. The correction also becomes the input's accessibility hint.
- Errors appear after a field is left, or for every field after a save attempt, so partial typing is not flagged.
- A rejected save moves the first invalid field, in screen order, near the top of the screen and focuses it. For Tag, which has no text input, screen-reader focus moves to the correction.
- Create and edit use the same messages. Parser and schema errors are never shown.
- Local checks run before any request. Saving still reads the authorized Group first, then re-checks Tag, member and currency availability against it, before any write.
- A retry of an uncertain submission skips local validation and resends its immutable attempt unchanged.
- The Amount rule is the ledger's own: `parseExpenseAmountMinor` was extracted in `@splitbook/shared/exact-money` and `normalizeExpenseMoney` now uses it. Messages use the currency's precision from `getCurrencyPrecision`, and nothing is rounded.
- A disabled Save explains why, both visibly and as an accessibility hint: an active submission, or a draft that could not be stored on the device.

## Automated verification

- Mobile: 238 tests. They include 26 new or converted controller regressions and 6 rendered interaction tests. The 26 regressions were confirmed failing on `main` before the change.
- Shared: 268 tests, including the new Expense-total rule compared with the full allocation rule. Web: 139 unit tests.
- Workspace typecheck and lint, and Prettier on the changed files, passed.
- The controller regressions cover:
  - blank and whitespace Description, before any request, followed by correction and a single POST
  - identical create and edit messages with no PATCH
  - blank, non-numeric, comma-grouped, zero, negative, over-limit and excess-precision amounts, including JPY
  - malformed and impossible dates
  - missing Tag, and a Tag archived between opening and saving
  - several errors at once, with focus on the first
  - errors shown only after a field is left
  - draft preservation through restart
- The rendered tests run the real controller through `ExpenseEditor` using `react-test-renderer` with host stand-ins. They check:
  - which Field owns each correction
  - the input's accessibility hint
  - focus and reveal requests
  - screen-reader focus for a missing Tag
  - correction clearing
  - the disabled-Save explanation
  - no ledger write while input is invalid

## Native verification

- **Environment:**
  - Emulator: `Medium_Phone_API_36.1` (`emulator-5554`, Android 16). It was already running and shared with the staging app; only `com.splitbook.app.dev` was reinstalled or used.
  - App: a fresh `expo prebuild` and Gradle `assembleDebug` of this branch, arm64 only, with Metro 8081.
  - Backend: the fictional backend on 4138, database `splitbook_mobile_50` on local Mongo 27018. Only the fictional personas were used.
- **Blank Description, new Expense:** Alex opened Maple House → Add expense, entered `250.50`, chose Tag General and saved with Description blank.
  - The form scrolled Description near the top, focused it with the IME shown, outlined it and showed "Add a description, such as Groceries." below it.
  - Amount and Tag were kept.
  - The backend log shows no request after the form's opening Group read.
  - After typing `QA-100 groceries`, one POST returned 201.
- **Blank Description, edit:** Opening that Expense, choosing Edit and clearing Description showed the same message on the focused field. No PATCH was sent.
- **Several errors:** Adding Amount `10.001` and Date `2026-02-30` showed three corrections beside Amount, Description and Date. Focus went to Amount.
- **Back and restart:**
  - Android Back first dismissed input, then returned to Groups. This is the existing behaviour; returning to the originating Group is #104.
  - After force-stop and relaunch, Resume draft restored `10.001`, the blank Description and `2026-02-30`. Corrections stayed hidden until the next save.
- **Correction:** Correcting the fields to `12.50`, `QA-100 groceries edited` and `2026-09-30` sent one PATCH (200).
  - Authorized reads showed a ₹12.50 September 2026 total.
  - Refreshed all-time Balances showed Alex owed ₹8.33, which is ₹12.50 split three ways.
- **Dark theme:** A dark-theme capture showed the same corrections legibly. The appearance was restored to System afterwards.
- **Recording:** A 1:58 screen recording covers a second new-Expense correction loop, "QA-100 video milk", ending in one POST (201) and "Expense saved."
- **Evidence:** screenshots and the recording are local artifacts, not committed:
  - `03-missing-description.png`
  - `07-edit-missing-description.png`
  - `08-multiple-errors.png`
  - `10-resume-after-restart.png`
  - `14-dark-errors.png`
  - `splitbook-100-expense-corrections.mp4`
- **QA data left in the fictional database:** Maple House now contains `QA-100 groceries edited` (₹12.50) and `QA-100 video milk` (₹480). The final dark-theme draft was discarded.

## Not verified here

- **Full soft keyboard:** this emulator has a hardware keyboard, so Gboard showed its floating toolbar rather than the full keyboard. The IME reported as shown, and the focused field was positioned near the top of the screen. Its position above a full-height keyboard still needs a physical-phone check.
- **Other device checks:** TalkBack announcements, large text, a small display and the staging APK were not checked. The rendered tests assert accessibility labels, hints and focus requests; they do not replace a screen-reader check.
- **Payer and split corrections:** these currently appear under the Paid by and Split summaries using the shared money messages. In-editor feedback is #101.
- **Account cleanup failure:** the first sign-in after reinstalling over an older dev build reported "Could not remove this account from the device." A subsequent "Sign out on this device" recovered it. This was not investigated here and is unrelated to this change.
