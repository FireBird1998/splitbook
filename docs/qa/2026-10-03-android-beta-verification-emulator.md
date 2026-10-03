# Android beta verification: emulator pass and design/code review (#109)

The emulator half of [#109](https://github.com/FireBird1998/splitbook/issues/109), with a design and code review of the compact Android app. It is run against `main` at `7afd15e`, after every #112 slice merged. The physical-phone checks, the signed staging APK and real Google accounts are still open; see [Unmet gates](#unmet-gates). This report does not imply beta or production approval.

## Build and environment

- **App:** the development client `com.splitbook.app.dev`, version 0.1.0, installed 2026-10-01 17:39. Its native dependencies match `main` (the last native change was 2026-10-01 01:15). The JavaScript comes from Metro, serving `main` at `7afd15e` with a cleared cache.
- **Backend:** the fictional local backend (`next dev`) from the same checkout, on `127.0.0.1:4138`, with database `splitbook_mobile_50` on Mongo port 27018.
- **Device:** emulator-5554 (`Medium_Phone_API_36.1`), 1080×2400 at 420 dpi, which is 411×914 dp.
- **Network:** traffic went through a logging proxy on 4139 (`adb reverse tcp:4138 tcp:4139`). The proxy recorded every request with its status and duration, and on demand it delayed responses, dropped every connection (offline), or let a write commit and withheld its response.
- **Two accounts:** the device was signed in as Sam. Priya and Alex were driven through authorized HTTP calls to join, edit, record payments and read back what the device saved. Later the device signed out, signed in as Priya, and back as Sam.
- **Settings restored afterwards:** I changed font scale, night mode, display size, TalkBack and the app's own Appearance during the run. Each was put back to its recorded value, and the port forwarding was restored. Running the TalkBack check raised a system notification-permission prompt for Accessibility Suite. I declined it, then cleared its permission flags back to their original state.

## Automated gate on `7afd15e`

| Check                                                                                                                                                                                       | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                                                                                                                          | pass                                                                                                                                                                   |
| `pnpm test:unit`                                                                                                                                                                            | pass: mobile 725, web 139, shared (all files)                                                                                                                          |
| `verify:groups`, `verify:settings`, `verify:financial`, `verify:expenses`, `verify:expense-edit`, `verify:settlements`, `verify:activity`, `verify:offline` against 4138, `TZ=Asia/Kolkata` | pass                                                                                                                                                                   |
| `verify:api`                                                                                                                                                                                | **fail, environment.** It asserts that Sam has exactly the two seed Groups, but this fictional database also holds QA Groups from earlier sessions. Not an app defect. |
| `measure-read-cache.ts` at 300 ms injected latency                                                                                                                                          | ran; table under [Timing](#timing-request-counts-and-loaders)                                                                                                          |

## Journeys verified on the device

Every saved record and balance below was confirmed through a separate authorized read: Priya's HTTP session, and later Priya signed in on the device.

| #109 journey                        | Result                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Incomplete → corrected **create**   | Save on an empty form shows "3 things to fix" with links. Each field explains its correction and focus moves to the first one; **0 requests**. After the fixes: one membership read, then one keyed `POST`.                                                                                                        |
| Incomplete → corrected **edit**     | Clearing the description gives one correction and 0 requests. After the fix, one `PATCH`, and the history shows "You changed the description".                                                                                                                                                                     |
| **Split methods**                   | Equal (₹1,000 ÷ 3; the leftover 1 paisa goes to the lowest member id, and the form says so). Amounts (4000/3000/2000, which blocks until it adds up). Percentage (33.33×3 blocks at "0.01% still to assign"; 33.34 saves as 1,499.85/1,499.85/1,500.30). Shares (2:1:1). Each server record equals the preview.    |
| **Multiple payers**                 | 600 + 400, and 1500 + 500, with a running "still to assign" and a "Give ₹400.00 to Priya" shortcut.                                                                                                                                                                                                                |
| **Balances**                        | The device matched the server and a hand calculation to the paisa (−2,333.18 / −1,633.18 / +3,966.36).                                                                                                                                                                                                             |
| **Delete**                          | Cancel sends nothing. Confirm sends one `DELETE` plus refreshes, and shows the Snackbar "Expense deleted · Groceries". The totals recompute.                                                                                                                                                                       |
| **Actual-payment review**           | A partial payment (1,000). An overpayment needs "I meant to pay more than suggested". A server-side change to the suggestion shows "The suggested amount changed. Check the amount, then record again." and sends no `POST`. Recording the exact remainder gives "Settled up" and the "Payment recorded" Snackbar. |
| **Ordinary draft restart**          | The process died (a dev-tool crash, below) mid-draft. Home showed "Continue where you left off". The form said "Unfinished draft. Nothing has been sent." with every value kept and locked until Resume.                                                                                                           |
| **Response-loss retry**             | The proxy let the `POST` commit and withheld the reply. After 20 s: "We couldn't confirm this save … can't be recorded twice". "Check and finish saving" resent the **same Idempotency-Key**, and the server holds **exactly one** Expense.                                                                        |
| **Stale edit review**               | Alex changed the notes while Sam edited the description. Sam's `PATCH` got 409, the app re-read the Expense, and "What's different" showed both versions. "Keep my version for review" then Save gives revision 2 with Sam's description _and_ Alex's notes.                                                       |
| **Offline Month miss**              | Offline, an unvisited August shows "August 2026 hasn't been opened on this phone yet. Connect to load it." A visited September shows its saved copy ("Saved 5:50 PM"). Invite is disabled with a reason.                                                                                                           |
| **Repeated foreground / reconnect** | Foreground three times: the first two reuse fresh reads (0 requests) and the third, past 30 s, sends 3. Nothing stacks. Reconnecting never resends a write. (See F3 for the Expense record.)                                                                                                                       |
| **Access revocation**               | Sam was revoked from Maple House while viewing it. A foreground inside the freshness window sends 0 requests, which is by design. The next pull gets one 403, and the screen shows "This Group isn't available". Home drops the Group. After restoring the membership and pulling, it is back.                     |
| **Account switch**                  | Sign-out (with confirmation) sends one `POST /sign-out`. Priya's Home shows only her Groups and figures (owes ₹1,966.67), and her view of Sam's Expenses matches. Sam's drafts were purged.                                                                                                                        |

## Release blockers for the staging phone test

1. **B1: every Android edit and delete on staging will look like a conflict.** The client sends the revision as `If-Match` (`mobile-controller.ts:663`). Vercel evaluates that header as an HTTP precondition and replaces the response with a non-JSON 412 _after the handler has committed_. The server only reads `If-Match` (`apps/web/src/lib/ledger-revision.ts`). The fix (`X-Splitbook-Revision`, with a server fallback) is in **draft PR #98**, which is unmerged and on an old base; its author reproduced the 412 against staging. An unauthenticated probe cannot show it, because 401 comes first.
2. **B2: Home totals can 500 on a cold Vercel worker.** `balance.service.ts` populates `members.user` but never imports the `User` model, so a cold instance of `/api/user/balances` throws `MissingSchemaError`. Local dev hides it, because other routes have already registered the model. The fix is also in PR #98.
3. **B3: the staging deployment is 3 days old.** It was built from a `codex/android-google-beta` worktree, so it lacks `main`'s backend changes (keyed Group create, the Activity `expenseId` filter, edit history and others). It needs a redeploy from `main` with B1 and B2 fixed, then a signed APK.

## Defects found

**Evidence:** **Device** means reproduced on the emulator. **Harness** means reproduced by a reviewer's scratch test against the real controller. **Code** means traced in source.

### High

- **F1: an Amounts split entry above about ₹7 trillion crashes the app, and the draft keeps the crash.**
  - **Evidence:** Device.
  - **What happens:**
    - Typing `88888888888888.01` throws `Amount cannot be represented by this client` while rendering `SplitSheet`. `splitEntryProblem` has no upper bound, and `toMajorAmount` throws above 2^46 minor units.
    - There is no error boundary.
    - The value was already in the draft, so reopening "Crash probe" from Home crashed again. The sheet is always mounted, so every route into the draft (Continue, Add expense in that Group, Discard) crashes.
    - Sign-out was the only exit.
  - **Fix:** bound Amounts entries by the maximum Expense amount in `splitEntryProblem` (existing "more than the Expense total" copy), and add an error boundary around the editor.
- **F2: a newly created Group never loads.**
  - **Evidence:** Device and Code; two reviewers found it independently.
  - **What happens:**
    - After Create, Expenses and Balances show skeletons indefinitely and nothing is requested. `createGroup` sets `screen: 'group'` but never starts the reads (`mobile-controller.ts:4633-4657`). Activity works, because it reads when opened.
    - It recovers only on a pull or when the Group is reopened. A new Household also shows All time, not the current Month.
    - Every beta tester's first Group hits this.
  - **Fix:** `openGroup(group.id, false)` after the publish.

### Medium

- **F3: an Expense record opened offline never refreshes after reconnecting.**
  - **Evidence:** Device and Code.
  - **What happens:**
    - The record shows "You're offline … saved at 5:47 PM". After reconnecting, its "Try again" re-reads only the session and the Group, never the Expense (`refreshView`, `mobile-controller.ts:4775-4787`).
    - The banner and the stale record stay. Only Options → Refresh or leaving the screen recovers it.
- **F4: confirmed writes don't invalidate the offline copy.**
  - **Evidence:** Device and Harness.
  - **What happens:**
    - After Sam edited Villa online, going offline showed the edited name in the list ("Villa deposit for 3 nights"). The record itself showed the pre-edit copy, without either edit in its history. The list and the record disagree.
    - Deleted Expenses on other Months and pages, and Activity, behave the same way.
  - **Where:** `invalidateReads` and `ledgerChanged` are memory-only. The offline fallback in `readCached` ignores `invalidatedAt`.
- **F5: Home is stuck on "Refreshing…" after opening a Group during the Groups load.**
  - **Evidence:** Device and Harness.
  - **What happens:**
    - With 4 s responses: pull Home, open a Group, return. More than 20 s later, "Refreshing…" was still shown with nothing in flight. The list response was dropped by the `viewRequest` guard, and `showHome` reloads only the balances.
    - On a first sign-in, the same sequence leaves the Home skeleton up indefinitely.
- **F6: a Home read that joins an older one is dropped after a list success.**
  - **Evidence:** Harness.
  - **What happens:** `cacheEpoch` rejects the joined read, leaving stale figures and an "Updating" label that never clears.
- **F7: an unconfirmed write that the server rejects for good has no exit.**
  - **Evidence:** Harness.
  - **What happens:**
    - An Expense attempt that gets a 422 with an unmapped code, a 409 `IDEMPOTENCY_CONFLICT`, or a deterministic 500 stays `uncertain` forever. There is no Discard, and opening any other Expense in that Group opens the stuck attempt.
    - Settlements behave the same way. A payment that can't be replayed (the counterparty was removed) locks every payment in the Group on that device.
    - Sign-out, which also drops every idempotency record, is the only exit.
- **F8: a failing local store traps the user or silently signs them out.**
  - **Evidence:** Harness.
  - **What happens:**
    - When the disk is full, a failed draft write blocks Back, Close and Discard on the form, because all three need a write.
    - A failed cache bookkeeping write calls `signOut()` with no message, wiping drafts and unconfirmed attempts.
- **F9: account-switch and purge edge cases.**
  - **Evidence:** Harness.
  - **What happens:**
    - The new account's cookie is saved before the old account's data is purged. A process kill in that window shows the old account's saved Home on the next cold start.
    - A cleanup that keeps failing (for example, the Google SDK `signOut()` throwing) loops forever, and sign-in is refused.
- **F10: archived Groups still accept writes by id.**
  - **Evidence:** Code.
  - **What happens:**
    - The Expense and Settlement services check membership only, and the client drops `isArchived`.
    - A member with the Group open after a web archive can still save Expenses and payments, which then appear nowhere.
- **F11: TalkBack misses failures.**
  - **Evidence:** Code, plus the accessibility event stream on the device.
  - **What happens:**
    - About ten error messages use `accessibilityRole="alert"` without a live region: Load more failed, Delete failed, Home balances error, and others. On Android that role is not announced.
    - The new "N things to fix" summary banner fired no accessibility event on the device. The field errors did fire live-region updates, and focus moved to the first field.
    - There is no `announceForAccessibility` call anywhere.
- **F12: dates are stored at device-local noon.**
  - **Evidence:** Harness and Code.
  - **What happens:**
    - The web stores UTC midnight, and Household Months use local bounds.
    - West of UTC, web-entered first-of-month rent shows in the previous Month.
    - A timezone change between saving and resuming a draft shifts the date.
  - **Impact:** low for an India-only beta.
- **F13: large text and small screens.**
  - **Evidence:** Device at 130% and 200%; Code.
  - **What happens at 130% on 360×640 dp (the spec target):**
    - Balances' "Record one once it's paid" and Activity's "Newest first" run off the screen edge.
    - Home's "Saved 6:16 PM · refreshing" wraps to three lines beside the wordmark.
  - **What happens at 200%:**
    - Expense titles truncate to a few letters.
    - The top-bar title truncates ("Add expe…").
    - Avatar initials clip ("A", "S").
    - Numeric fields scroll ("2345.67" for 12,345.67).
  - **By measurement (Code):** at 175% or more, the Save and Record labels with their amounts overflow the button, and hero amounts are cut with an ellipsis.
- **F14: no app icon or splash.**
  - **Evidence:** Device.
  - **What happens:** `app.config.ts` uses none of the prepared brand assets in `apps/mobile/assets/brand/`; their integration is described in `docs/design/brand/README.md`. A release APK would ship the default Android icon and a robot splash.

### Low

- **Expense form:**
  - A payer entered as "0" is saved as a payer ("2 people paid").
  - A bad payer entry is reported on the Split tile.
  - JPY and KRW show a "0.00" placeholder.
  - An unchanged "Save changes" sends `{}`.
  - Deleting briefly shows the locked edit form ("Saving expense…").
  - Server 422s like `INVALID_TAG` are not mapped to fields.
- **Payments:**
  - The record sheet says "Former member" before the Group loads.
  - Retry offline gives no feedback.
  - Raw Zod text can reach the payment banner.
  - Two members can record the same real payment, because the server accepts any amount.
- **Reads:**
  - After reconnecting, a 500 is shown as "hasn't been opened on this phone".
  - The offline banner survives a successful Activity pull.
  - Foregrounding collapses loaded pages and closes an open Activity event.
  - One failed cache save leaves a warning for the session.
  - The read cache is one unbounded JSON document, rewritten per response on the display path.
  - Cache keys embed timezone-specific bounds.
- **Session:**
  - Members is not re-authorized on foreground.
  - Foregrounding a signed-out screen erases its message.
  - An aborted server sign-out is never retried.
  - An invalid link wipes a saved pending invitation.
  - A handshake 5xx is shown as "not configured".
- **Contract:**
  - Former members show as "Unknown" in Balances but by name elsewhere.
  - A race can trip "Inconsistent expense count".
  - The Expense sort has no `_id` tiebreak.
  - `/api/join` is unthrottled, and any member can rotate the link.

### Design notes (device screenshots)

- **Destructive and confirmation styles:**
  - The destructive "Delete expense" button uses primary indigo, not a danger style.
  - "Discard this expense draft?" is a native platform alert (uppercase KEEP DRAFT / DISCARD), while delete uses the app's bottom sheet.
- **Sheet behaviour:**
  - The four split-method chips wrap, leaving "Shares" alone on a second row, even at 100% on a 411 dp phone.
  - The payer sheet stays open after a single choice, while the Tag sheet closes on selection.
- **Alignment and colour:**
  - The "Changed" badge and the record's "Edit" hug the top of the bar rather than its centre.
  - The pull-to-refresh disc is white in dark mode.
- **Denied Group:** it keeps a live bottom navigation that does nothing.
- **Create Group:** Trip dates are typed as `YYYY-MM-DD`, while the Expense date has a calendar.
- **Copy:**
  - "You no longer have access to this group" (elsewhere "Group").
  - "Records a payment made outside Splitbook" (elsewhere "SplitBook").
  - Activity says "You recorded a payment · Sam Chen → Alex Rivera", naming yourself in the third person.
- **Checked and on spec:** light and dark parity across Home, Expenses, Balances, Activity, the record, the form, all four sheets and Settings. Dark mode used tokens throughout, with no hard-coded colours found.

### Known and already documented

- A `PATCH` or `DELETE` resent by OkHttp after a commit gets 409 and is shown as a conflict with the user's own change (`docs/qa/2026-10-01-android-transparent-resend.md`).
- A dev-client crash in `CxxInspectorPackagerConnection` (React Native's debugger websocket) killed the app once during the run. It is development tooling only.

## Timing, request counts and loaders

Dev-build timings are dominated by loading the JavaScript bundle from Metro. They are **not** release timings.

- **Cold start (dev):**
  - `am start -W` TotalTime: 5.3–8.0 s.
  - First app screen ("Opening SplitBook…"): about 25 s.
  - "Checking your session…": about 27 s, then the saved Home marked "Saved hh:mm · checking".
  - The first request (`get-session`): 34–41 s after launch.
- **Warm start (dev):** `am start -W` HOT, 1.62 s. The screen state is kept.
- **Release cold and warm timings and blank-content duration:** not measured. They need the signed staging APK on a phone.

The controller harness (public controller, real HTTP, 300 ms injected per request) gave these counts and times:

| Journey                                            | Requests | First content |    Settled |
| -------------------------------------------------- | -------: | ------------: | ---------: |
| Sign in, Groups and Home (cold)                    |        4 |      1,298 ms |   1,298 ms |
| Open a Group (first time)                          |        3 |        977 ms |     977 ms |
| Back to Groups / reopen within 30 s                |    1 / 0 |             0 | 317 / 1 ms |
| Three foreground events within / after 30 s        |    0 / 3 |             0 | 2 / 990 ms |
| Previous Month (first visit)                       |        2 |        341 ms |     660 ms |
| Confirmed Expense create, then affected views      |        6 |      1,303 ms |   1,940 ms |
| Restart with saved views: restore, Groups and Home |        3 |        630 ms |     950 ms |

Device request counts through the proxy:

| Action                           | Requests                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Cold launch with a valid session | 3                                                                                 |
| Open Add expense                 | 1 (membership)                                                                    |
| Create, edit or Settlement       | 6–7: a live check, the write (create and Settlement keyed), and 3–4 refresh reads |
| Open a record                    | 3 (Group, Expense, history)                                                       |
| Lost-response retry              | 6                                                                                 |
| Stale-edit conflict              | 3 (Group, 409, re-read)                                                           |
| Revocation pull                  | 1 (403)                                                                           |
| Persona sign-in                  | 4                                                                                 |

- **Offline:** each dropped request was attempted twice (OkHttp's transparent retry).
- **Ordering:** reads are sequential (session → Groups → balances; Group → Expenses → balances), so cold Home costs three round trips. #180 tracks overlap.
- **Loaders:** one skeleton plus a linear bar on the first load of a view. Refreshes keep the content and show only a status line ("Saved hh:mm · refreshing" / "Updated hh:mm"). No full-screen spinner was seen except the brief "Checking your session…" before the saved Home appears. Reviewers noted the legacy centred spinner when opening an uncached Expense, and that the linear bar never animates.

## Unmet gates

- **Signed staging APK, isolated staging backend and real approved accounts.** Blocked by B1–B3 (PR #98 fixes, a staging redeploy from `main`) and by the APK build.
- **Physical phone:**
  - TalkBack speech: input values, the error banner and Snackbar announcements, focus in sheets and on return.
  - Docked-keyboard layout: Save above the keyboard, the payer sheet at 360×640 with the keyboard open. The emulator's hardware keyboard only shows Gboard's floating bar.
  - Real cold and warm timing, blank-content duration and loader count on the release build.
  - Google sign-in, approved and denied.
- **Automated:** `verify:api` needs a clean fictional database to pass. Resolved by #185: it now checks the seed Groups by identity, not an exact count, and passes on this database.
