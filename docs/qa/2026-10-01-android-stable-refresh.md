# Android stable refresh (#102)

This change implements [#102](https://github.com/FireBird1998/splitbook/issues/102) under specification [#99](https://github.com/FireBird1998/splitbook/issues/99), starting from `main` at `a5ae1c5`.

On `main`, three things happened during a refresh:

- `refreshHome`, `openGroup` and `beginExpenseRead` cleared loaded Home and Group figures before the request finished.
- The native pull indicator turned on for any loading section, including automatic foreground refreshes.
- Section spinners appeared at the same time as the pull indicator.

Request coalescing and freshness windows remain #103, and the TanStack Query pilot remains #108; neither is part of this change.

## Behaviour

- **Content availability** is now separate from request activity. Home and Balances carry `refreshedAt`, the time the shown figures were last read, and Balances also carry `stale`. Expenses carry `refreshedAt`.
  - While the same account refreshes the same view, Home figures stay on screen, as do the Group's Expenses for the selected Month, Group detail and Balances.
  - Opening another Group still starts empty.
- **The Expense-before-Balance ordering is preserved.** An Expense read can materialize recurring Expenses, so:
  - it retires any Balance or Home response still in flight;
  - prior Balances stay visible but are marked unverified, with the label "Updating running balances. These figures are from … and may change.";
  - only a Balance read made after that Expense read clears the label.
- **Month selection** clears the previous Month's Expenses immediately, so no list ever appears under the wrong Month label. Running Balances are all-time and are never filtered by Month.
- **A failed refresh** keeps the prior figures and their original time, with a message such as "Could not update running balances. Please try again. Showing running balances from 1:36 AM." and a Retry button. The Expense warning sits under the Expenses heading, above the Month total.
- **Denial and account changes** still remove protected content immediately:
  - A 403 or 404 evicts the Group, its card and Home aggregates.
  - Sign-out resets the snapshot.
  - Late responses are dropped by the existing generation, view and request guards.
- **One progress cue per operation:**
  - First load without content: the section placeholders.
  - Pull-to-refresh: the native pull indicator only. `controller.refresh('pull')` sets `snapshot.pull`.
  - Automatic foreground refresh and every Retry button: one quiet "Updating…" in the fixed header. The default `refresh()` never sets `pull`.
  - Pagination: a footer, "Loading more expenses…".

## Automated verification

- Mobile: 228 tests.
- 11 new or updated controller regressions were confirmed failing on `main`. A twelfth, "opens another Group without the previous Group's figures", guards existing behaviour and already passed. They cover:
  - retained content during a background refresh, with ordered Expense-then-Balance reads and updated timestamps
  - the pull flag set only for a pull, never for a retry or an automatic refresh
  - Home failure keeping its original time
  - an Expense failure keeping unverified Balances
  - a Month change clearing Expenses while keeping all-time Balances
  - denial during a refresh
  - the newest of two overlapping refreshes winning
  - sign-out during a refresh, with a late response
  - pagination keeping the list
- Two existing tests were updated to the new desired behaviour. The materialization test now also proves that a pre-materialization Balance response carrying different figures is discarded.
- 5 rendered tests (`src/ui/financial-views.test.tsx`) drive the real controller through `GroupFinancialViews` and `HomeBalances`. They check:
  - section placeholders only on a first load
  - one quiet cue and no spinners during an automatic refresh
  - retained figures with the original time and Retry buttons after failure
  - Home failure
  - the pagination footer without refresh cues
- Workspace typecheck and lint, and Prettier on the changed files, passed.
- `react-test-renderer@19.2.3` is added with exactly the same `package.json` and lockfile lines as #100's PR, so the two merge without conflict there.

## Native verification

- **Environment:**
  - A dev APK on `emulator-5554`. The build is shared with #100's verification; this branch changes JavaScript only.
  - Metro, with its cache cleared after the branch switch.
  - The fictional backend on 4138 (`splitbook_mobile_50`).
  - A QA-only loopback proxy: device `4138` was reversed to host `4139`, which forwarded to `4138`. It delayed financial GETs by 0.8–2.5 s and could inject a 503 for Expense reads.
  - The proxy was removed afterwards (`adb reverse tcp:4138 tcp:4138`).
- **Alex, Maple House:**
  - **First open:** section placeholders only ("Loading running balances…"), with no pull indicator.
  - **Month change to September:** the Month label changed immediately and September's Expenses loaded separately. Running Balances stayed visible with the "Updating … from 1:31 AM" label.
  - **Automatic refresh (backgrounded, then resumed):** the header showed "Updating…". Balances, Month and Expenses stayed on screen, with no pull or section spinners. The proxy log shows Group, then Expenses, then Balances.
  - **Manual pull:** only the native pull indicator appeared, and the figures stayed.
  - **Injected Expense 503:** Balances showed "Could not update running balances. … Showing running balances from 1:36 AM." with a Retry button. Expenses showed "… Showing September 2026 expenses from 1:36 AM." above the ₹492.50 total and both QA Expenses.
  - **Retry:** after clearing the failure, one Expense read and one Balance read restored current figures.
- **Sam, Maple House:**
  - After loading, `control.mjs revoke-member sam household` and a foreground refresh showed "This Group isn't available — You no longer have access to this group."
  - All figures were removed, and the Maple House card disappeared from Groups.
  - Membership was restored with `restore-member`. A pull on Groups brought the card back.
- **Paced recording:** a 1:31 recording of Sam's September view covers an automatic refresh with "Updating…" and a pull with retained Balances labelled as updating.
- **Evidence:** screenshots and recordings are local artifacts, not committed:
  - `22-loaded.png` and `23-month-change.png`
  - `24-background-refresh.png` and `25-manual-pull.png`
  - `26a-failure-balances.png` and `26d-failure-expenses.png`
  - `29-denied.png`
  - `splitbook-102-stable-refresh.mp4`
- **Not an app issue:** an extra refresh seen once during scripted QA came from the helper's own scroll gestures reaching the top of the list, which is pull-to-refresh. One isolated foreground event produced exactly one Group → Expenses → Balances sequence.

## Review fixes

Two review findings were reproduced before fixing: by controller regressions, and by App rendering tests that mount the real `App.tsx` with only native modules replaced.

- **P1, wrong Month content:**
  - **Cause:** `openGroup` captured the Month when a refresh started and re-applied it after the Group read. If the member chose August while an older September refresh was reading the Group, the late response switched back to September. Retained August Expenses then appeared under that label while September reloaded.
  - **Fix:** a same-Group refresh now keeps whatever Month is selected when its Group read returns.
  - **Also:** Expenses now record the Month they belong to (`expenses.month`). The controller never keeps, appends to or shows Expenses under another Month, and `GroupFinancialViews` renders them only when that Month matches the label.
  - **Regressions:** a controller test with a subscriber that records every published snapshot pairing a Month label with another Month's Expenses; the App test drives the same sequence with a foreground event and the rendered Previous month button.
- **P2, content hidden after a Group-read failure:**
  - **Cause:** a 503 from `GET /api/groups/:id` sent `App.tsx` to its error branch, which rendered only the Group header.
  - **Fix:** Group detail now has `refreshedAt`. With a known Group, the whole Group screen stays: detail, Balances, Month and Expenses. Above it sits "… Showing Maple House from 2:26 AM." with a Retry Group button. A Group never loaded still shows the full-screen error.
  - **Regressions:** a controller test, and an App test that pulls to refresh, checks the warning, time, figures and pull indicator, then retries.
- **Wiring check:** a third App test confirms the real `RefreshControl` wiring. A foreground event never turns on the pull indicator; a pull does.
- **Checks:** Mobile has 233 tests. Workspace typecheck, lint and Prettier passed.

Native evidence, as Sam, on the same emulator, dev APK and fictional backend, through the QA proxy (a new Group-read delay and 503 mode):

- **QA data:** Sam added a clearly named Expense, "QA-102 August check" (₹100, 15 Aug 2026), so August had visible content. One POST returned 201.
- **P1:**
  - With September shown, the app went to the background and returned. The proxy held that refresh's Group read for 9 s.
  - Previous month was chosen, loading August (₹100 total).
  - When the older Group read returned, the refresh continued with August's Expenses and then Balances. The screen stayed on August 2026 with the ₹100 August total, and September never reappeared.
  - Proxy log: Group read at +0 s; August Expenses at +3.8 s and Balances at +4.7 s; after the Group reply, Expenses at +9.8 s and Balances at +10.6 s.
- **P2:**
  - An injected Group-read 503 during an automatic refresh kept Balances, Month and the August Expenses visible below "The server could not complete this request. Please try again. Showing Maple House from 2:26 AM." and a Retry Group button.
  - After the failure was cleared, Retry Group re-read the Group, and the warning disappeared.
- **Evidence:** local artifacts, not committed:
  - `41-p1-august-while-older-refresh-pending.png`
  - `42-p1-after-older-refresh.png` and `43-p1-august-list.png`
  - `44-p2-group-503.png` and `45-p2-recovered.png`
  - `splitbook-111-review-month-and-group-failure.mp4` (2:28)
  - `splitbook-111-review-group-retry.mp4` (0:38)

### Quiet retries

Retry buttons now use the quiet header status instead of the native pull indicator. The pull indicator is reserved for a pull-to-refresh.

- The Retry Group button, the Groups error retry and the empty-Groups refresh all call the default quiet `refresh()`.
- On the emulator, Retry Group was tapped after an injected Group 503, with the Group read delayed 6 s. The header showed "Updating…" and no pull indicator, and the Group and Balances stayed visible (`46-retry-quiet.png`). After the reply, the warning and "Updating…" cleared (`47-retry-done.png`).
- The real-App test holds the retried Group read and checks for the quiet status, figures still on screen and no pull indicator. The controller test checks that the default `refresh()` never sets `pull`.

## Not verified here

- **Physical phone, TalkBack, large text and dark theme** were not checked for these states. Freshness copy uses `toLocaleTimeString` and was checked only on this emulator.
- **Timing measurements:** under the proxy delay, a same-view refresh now keeps figures on screen for its whole duration. `main` was not measured on the device with the same proxy, so no before-and-after timing is claimed.
- **Pagination on device:** it was not exercised because this fixture has fewer than 21 Expenses in a Month. Controller and rendered tests cover it.
- **Refresh during a first load:** a foreground refresh can still restart a first load that is in progress, because repeated identical reads are not yet coalesced. That is #103.
