# Android Group and Settlement corrections (#105)

This change implements [#105](https://github.com/FireBird1998/splitbook/issues/105) under specification [#99](https://github.com/FireBird1998/splitbook/issues/99), starting from `main` at `eb9cd92`. It extends the field feedback from #100 (the Expense form) to Group creation and to recording an actual payment.

On `main`:

- **Group creation:**
  - A missing Group name only disabled Create.
  - The name was not marked required.
  - Invalid Trip dates produced one form-level message, "Enter valid Trip dates as YYYY-MM-DD.".
  - Other schema problems surfaced as raw validator text, such as "Name is required".
- **Settlement entry:**
  - An invalid amount was only rejected when Review was pressed.
  - The raw validator error appeared at the top of the screen, away from the Amount input.
  - Record could stay disabled above the suggestion without saying why.
  - A payment recovery store that was unavailable made Record silently do nothing.

## Behaviour

- **Shared field feedback:** `src/data/field-feedback.ts` is a pure module, reusable by the compact forms (#114 onward). It holds:
  - form validation state: touched, submitted, errors, and a focus request per rejected save
  - the visible-error rule
  - the correction summary
  - the Amount and calendar-date rules
  - #100's Expense form now uses the same Amount and date rules, with unchanged copy.
- **Group creation:**
  - The name is marked "· Required", with the hint "Everyone you invite sees this name."
  - Create stays available for incomplete input, so it can explain what is missing. A blank name gets "Add a name for this trip, such as Goa Weekend." beside the field; the copy follows the Theme's noun and example.
  - Trip dates get their own corrections:
    - "2026-02-30 isn’t a real date. Check the day and month."
    - "Enter the date as YYYY-MM-DD, such as …"
    - "Choose an end date on or after the start date, …" on End date.
  - Corrections appear after a field is left, or all at once on Create. A rejected Create sends nothing. It scrolls to and focuses the first invalid field, and keeps every entered value.
  - With several errors, one summary is announced, for example "Correct 2 fields before creating the Group: Start date and End date."
  - While the Group is being sent, Create is disabled with the hint and visible text "Sending this Group. Keep this screen open until SplitBook confirms it."
- **Settlement entry:**
  - The Amount is a labelled "Actual amount paid · Required" field, with the hint "What Sam Chen actually paid, in INR. Partial payments are fine."
  - Its corrections sit beside the input, using the shared money rules with nothing rounded, for example "INR amounts can have at most 2 decimal places. Nothing is rounded for you."
  - An invalid Review sends nothing, focuses the Amount, and keeps the payer, recipient, currency, amount and note.
- **Review:**
  - The heading reads "Review the payment already made".
  - The review states: "You’re recording that Sam Chen already paid Alex Rivera ₹20.00 INR. SplitBook doesn’t move money or contact a bank; recording only updates this Group’s balances."
- **Unchanged rules:**
  - Above-suggestion acknowledgement, payer or recipient authorization, live membership and currency checks, and the latest-suggestion check before recording all work as before.
  - Record explains its disabled state: "Record is available once you confirm this is the actual amount paid."
  - While saving, the progress label says "Recording payment… Keep this screen open until SplitBook confirms it."
- **Storage requirements:**
  - A payment is only sent once its immutable retry identity is stored on the device.
  - If recovery storage is unavailable, or storing the attempt fails, nothing is sent and the screen explains why, keeping the entries: "Nothing was sent: this device couldn’t store a recovery copy of the payment. …"
  - No offline write queue is introduced.
- **Unchanged guarantees:** explicit retry of the same submission, the immutable attempt and never resending on foreground, restart or reconnect.

## Automated verification

- **Checks:** mobile 303 tests, shared 268, web unit 139. Workspace typecheck, lint and Prettier passed.
- **New controller suite, `src/data/form-corrections-controller.test.ts` (11 tests).** It drives both members' devices through one fictional server with idempotent Settlements, and covers:
  - a missing name that is visible only after the field is left or Create is pressed, sends nothing, focuses Name, keeps every entry, then creates once corrected
  - Trip date corrections and focus order
  - no second POST during an active submission
  - five invalid amounts (blank, too precise, zero, a comma, too large), each attached to Amount with payer, recipient, currency, amount and note kept and no request
  - a corrected amount reviewed as a payment already made, with the above-suggestion acknowledgement still enforced
  - a lost response followed by a restart and an explicit retry of the same submission, leaving one record that the other member sees once
  - a failed recovery-copy save sending nothing and explaining why
- **New rendered suite, `src/ui/form-corrections.test.tsx` (4 tests).** It renders the real form components connected to the real controller, and covers:
  - the required marker
  - the correction attached to the Name field and announced in its accessibility hint
  - focus and reveal on a rejected Create
  - a correction disappearing once fixed
  - the Trip date correction after the field is left
  - the disabled Create explanation while sending
  - the Settlement Amount correction attached to its input, with payer, recipient, currency and note kept
  - the "already made" review copy
  - the disabled Record explanation, acknowledgement, and one POST
- **Updated tests:** two existing Group creation tests expected the old generic messages and now expect the field-level behaviour.

## Emulator verification

- **Setup:**
  - A dev build on `emulator-5554` with the fictional backend on 4138.
  - A QA-only loopback proxy that added 300 ms per request and logged every request.
  - Fictional Maple House, where Sam owed Alex ₹97.50.
- **Invalid to corrected Group, as Sam:**
  - With the Trip name blank, the Start date was typed as "2026-02-30" and the field left: its correction appeared beneath it.
  - Create trip with the name still blank sent nothing (empty proxy log). It showed "Add a name for this trip, such as Goa Weekend." beside the Name field, scrolled to it and focused it, and the keyboard opened.
  - After entering "QA-105 corrected trip" with dates 2026-11-20 to 2026-11-22, both corrections cleared. Create sent exactly one `POST /api/groups` (201), and the new Trip opened.
- **Settlement correction, as Sam:**
  - Sam chose "Review payment from Sam Chen to Alex Rivera", entered 12.345 and the note "QA-105 retry check", then pressed Review payment.
  - Nothing was requested. The precision correction appeared under the focused Amount field, and "Sam Chen paid Alex Rivera", "ACTUAL PAYMENT · INR", the amount and the note all stayed.
  - Correcting the amount to 20 led to the review screen: "Review the payment already made … SplitBook doesn’t move money or contact a bank …".
- **Lost response, then an explicit retry:**
  - **Held response:** a second payment of 15 ("QA-105 explicit retry") was recorded while the proxy held the response past the app's 20 s timeout. One POST reached the server (201), and the app showed the locked uncertain state: "The payment may already be recorded. Retry this exact submission to confirm it; it cannot be edited."
  - **Foreground return:** backgrounding and returning sent only the session check and a Group read, with no POST.
  - **Explicit retry:** "Retry same payment record" sent one POST with the same key (201), and the app showed "Payment recorded".
  - **Result:** the remaining suggestion was ₹62.50 (97.50 − 20 − 15).
- **Second account:**
  - After signing out and continuing as Alex, Maple House Payments listed "Sam Chen paid Alex Rivera ₹15.00 INR · QA-105 explicit retry" and "… ₹20.00 INR · QA-105 retry check", each once.
  - The device was then signed back in as Sam.
- **Finding: the Android HTTP layer resent a POST.**
  - When the proxy dropped the ₹20 response at once instead of holding it, the proxy logged a second identical POST immediately, and the app reported success without ever seeing a failure.
  - This looks like OkHttp's transparent retry after a dropped connection.
  - It carried the same `Idempotency-Key`, so the server returned the same record and the ledger holds one payment.
  - No app code resent it. Writes without an idempotency key, notably Group creation, deserve a separate check; this is suggested as a follow-up task and is not changed here.
- **QA data left in the fictional database:**
  - The Trip "QA-105 corrected trip".
  - Two Maple House payments from Sam to Alex: ₹20 "QA-105 retry check" and ₹15 "QA-105 explicit retry".
- **Evidence:** local artifacts, not committed:
  - `105-create-rejected.png` and `105-create-corrected.png`
  - `105-settlement-rejected.png` and `105-settlement-review.png`
  - `105-retry-uncertain.png`
  - `105-alex-history.png`
  - `splitbook-105-settlement-corrections.mp4`, 5:08

## Not verified here

- **Other environments:** a physical phone, TalkBack (only the accessibility labels, hints and live regions were inspected), large text, the dark theme and staging were not checked for these states.
- **Keyboard:** the emulator uses a hardware keyboard, so the full soft keyboard was not verified. Focus was confirmed through the focused field and the input method state.
- **Server-side validation codes:** a 422 on Group creation still shows the generic "Check the Group information and try again.", and a Settlement 422 still uses its existing mapped messages. Local validation now catches the same rules first.
