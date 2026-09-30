# Android cached views and coalesced reads (#103)

This change implements [#103](https://github.com/FireBird1998/splitbook/issues/103) under specification [#99](https://github.com/FireBird1998/splitbook/issues/99), starting from `main` at `6159385`. It builds on the stable-refresh work already merged in #110, #111 and #132.

On `main`, every navigation, foreground return, pull and Retry started fresh network reads for the whole view:

- Reopening a Group moments after leaving it read the Group, its Expenses and its Balances again.
- Each overlapping foreground event started its own Group read.
- Saved copies were used only as an offline fallback, after a network read had failed.

The TanStack Query pilot remains optional ticket #108 and is not part of this change.

## Behaviour

- **Display freshness:**
  - A read verified in the last 30 seconds is shown again without another request. This covers the Groups list, Home, Group details, each Month's first Expense page and running Balances.
  - The policy applies to navigation, Month changes and foreground returns.
  - It is `DISPLAY_FRESHNESS_MS` (30 000 ms), adjustable per controller with `displayFreshnessMs`.
  - Reused figures keep their original `refreshedAt`.
- **Pull, Retry and confirmed writes always read again:**
  - Pull-to-refresh, every Retry button and each section refresh button bypass the window.
  - PR #132's feedback is unchanged: only a pull turns on the native spinner, and a Retry uses the quiet status but genuinely reads again.
  - `controller.refresh()` defaults to `'retry'`. The app's foreground handler calls `refresh('foreground')`.
- **One in-flight read per path:**
  - Overlapping identical reads share one request. The key is the account session, the environment (the controller's backend origin), the Group, and the Month and page in the query.
  - Each caller still applies its own view, Month and request guards, so the newest selection wins as before.
- **Saved content shown at once, with its time:**
  - A Group, Month page or Home that is not on screen yet appears immediately from this session's reads or this device's saved copy while it is read again.
  - After a restart, saved Groups and Home appear as soon as the session is verified.
  - Only saved content for the same account and path is shown: the stored envelope and the parser are validated, and membership is checked.
  - A saved copy is never treated as fresh; it is always read again.
  - The header cue reads "Saved 4:05 AM · updating", matching the approved compact design's "Saved hh:mm · refreshing".
- **Expense-before-Balance ordering is unchanged:**
  - Starting an Expense read removes the Group's reusable Balances and Home figures.
  - A Balance or Home response that started before that read is neither reused nor saved.
  - Reused Balances therefore always follow the latest Expense read. When a Month page is reused, its Balances are reused only if they are still fresh.
- **Invalidation:**
  - After an Expense create, edit or delete, or a Settlement, the Group's Expense pages for every Month, its Month summaries, Expense records, Activity, running Balances and Home are all invalidated. This happens as soon as the write returns, whatever its outcome.
  - Group creation and joining invalidate the Groups list and Home.
  - Invalidated reads are never reused, joined, saved, or shown early from the saved copy in this session.
  - A read that was in flight when the change landed is read again if its view is still on screen. Its obsolete response is dropped.
  - The post-write refresh also re-reads the Group's details.
- **Unchanged guarantees:**
  - Settlement suggestions still come from live reads.
  - Denial evicts content immediately, from memory and from the saved copy.
  - Sign-out and account changes clear everything, and late responses from a retired session are dropped.
  - Foreground and reconnect never replay a financial write or replace a draft.
  - Offline, nothing is reused from memory: reads fall back to the saved copy as before.
  - An uncached view ends in "This view was not saved on this device. Connect to load it." with a Retry, never a loader.
- **Layout fix:** the longer header status wraps instead of pushing Settings off the screen.
- **Group-read failure:** if the Group read fails after saved figures were shown, those sections stop showing as updating.

## Measurements

### Controller against the real backend

`scripts/measure-read-cache.ts` drives the public controller against the fictional backend, with a fixed 300 ms delay injected per request. It creates and then archives its own fictional Household Group. To reproduce:

```sh
TZ=Asia/Kolkata node --import tsx apps/mobile/scripts/measure-read-cache.ts
```

"First content" is when the view first showed its content, and "settled" is when the action finished. Both are in milliseconds; the dev server's routes were warmed first.

| Journey                                         | `main` requests | `main` first content / settled | Branch requests | Branch first content / settled |
| ----------------------------------------------- | --------------: | -----------------------------: | --------------: | -----------------------------: |
| Sign in: Groups and Home, no saved views        |               4 |                    1291 / 1291 |               4 |                    1294 / 1294 |
| Open the Group for the first time               |               3 |                    1004 / 1004 |               3 |                      998 / 998 |
| Back to Groups                                  |      1 (Home)\* |                        0 / 319 |      1 (Home)\* |                        0 / 318 |
| Reopen the Group within 30 s                    |               3 |                      965 / 965 |           **0** |                      **1 / 2** |
| Three overlapping foreground events within 30 s |               5 |                        0 / 971 |           **0** |                          0 / 2 |
| Three overlapping foreground events after 30 s  |               5 |                        0 / 979 |           **3** |                        0 / 977 |
| Pull to refresh                                 |               3 |                        0 / 962 |               3 |                        0 / 960 |
| Previous Month, first visit                     |               2 |                      321 / 641 |               2 |                      324 / 642 |
| Back to this Month within 30 s                  |               2 |                      334 / 652 |           **0** |                          1 / 1 |
| Previous, this, previous Month without waiting  |               4 |                      332 / 651 |           **0** |                          0 / 1 |
| Confirmed Expense create, then affected views   |     6 (1 write) |                    1303 / 1947 |     6 (1 write) |                    1300 / 1948 |
| Restart: Groups and Home, saved views           |               3 |                      954 / 954 |               3 |                      638 / 960 |
| Restart: open the Group, saved views            |               3 |                      981 / 981 |               3 |                    **1** / 978 |

\* Home is read again after every Group visit, because the Group's Expense read may have materialized recurring Expenses.

Notes on the table:

- **Restart, Groups and Home (638 ms):** the saved Groups appear once the session is verified. Saved Home appears only after the live Groups read, so an unlisted Group's Home figures are purged before anything is shown.
- **Confirmed Expense create:** the request count is the same because the write must re-read every affected view. The two Group reads are the authorized context read before the write and the post-write refresh.

### Android emulator

- **Setup:**
  - A dev build on `emulator-5554` as the fictional Sam, in Maple House.
  - Every API request passed through a QA-only loopback proxy that added 1.5 s: device `4138`, then host `4139`, then the fictional backend on `4138`.
  - The same scripted journeys ran against `main` JavaScript and then against this branch, with Metro's cache cleared in between.
  - Request counts come from the proxy log. On this dev build, a tap takes 2–4 s to become a request, so the device times are not comparable with the harness above.

| Journey                                   | `main`                        | Branch                                             |
| ----------------------------------------- | ----------------------------- | -------------------------------------------------- |
| Open Maple House                          | 3 (Group, Expenses, Balances) | 3, with the saved copy shown first after a restart |
| Back to Groups                            | 1 (Home)                      | 1 (Home)                                           |
| Reopen within 30 s                        | 3                             | **0**                                              |
| Two foreground returns within 30 s        | 4 (two Group reads)           | **0**                                              |
| Three rapid foreground returns after 30 s | 5 (three Group reads)         | **3** (one shared set)                             |
| Month change, last read over 30 s ago     | 2 (Expenses, Balances)        | 2                                                  |
| Month change back within 30 s             | 2                             | **0**, in both directions                          |

- **Per-resource freshness:** in one recorded run, a foreground return arrived 32 s after the Group read but 26–28 s after its Expense and Balance reads. Only the Group details were read again.
- **Opening the Group after a restart:**
  - `main` showed "Loading running balances…" until its third request finished.
  - The branch showed the saved Group, Balances and Month at once, with "Saved 4:04 AM · updating", while the three reads ran.
- **After the window:** a foreground return showed "Saved 4:03 AM · updating" in the header, and the figures stayed visible.
- **Evidence:** local artifacts, not committed:
  - `103-branch-foreground-updating.png`, from before the layout fix, where Settings was pushed off screen
  - `103-branch-header-wrap.png`, restart with saved Home and a wrapped header
  - `103-rec-open-saved.png`
  - `103-month-within-window.png`
  - `splitbook-103-cached-reads.mp4`, 3:13

## Automated verification

- **Mobile: 275 tests.** Shared: 268. Web unit: 139. Workspace typecheck, lint and Prettier passed.
- **New suite, `src/data/read-cache-controller.test.ts` (16 tests).** It uses a fictional backend whose ledger version rises with each accepted write, plus device stores that survive a restart. It covers:
  - the adjustable window and original times
  - read ordering after the window
  - bypass by pull, Retry and section Retry, and the pull indicator only for pulls
  - one shared read for overlapping foreground events and a pull
  - Month reuse, including Balances never older than an Expense read
  - a pre-write read that is never joined, shown or saved
  - a re-read when a write lands mid-read with its response lost
  - invalidation of pages, Months, Balances, Home and Activity after an Expense and after a Settlement
  - no replayed write or replaced draft across foreground, retry and pull
  - the saved copy after a restart
  - a Group-read failure over saved figures
  - denial eviction
  - no reuse across sign-out or an account change
  - a late shared response after sign-out
  - offline misses ending in actionable errors
- **Also added:**
  - A rendered App test, "reopens a recent Group without a request, then shows it with its time while it is read again".
  - `financial-controller.test.ts` "shares one Expense read between overlapping refreshes and applies it once". It replaces the earlier "applies only the newest of two overlapping refreshes", because identical overlapping reads are now shared. The newest-selection rule for different Months is still covered by the Month tests from #111.
- **Checked against `main`:** 12 of these tests failed on `main`'s controller, confirming they test new behaviour:
  - 10 of the 16 in the new suite
  - the rewritten coalescing test
  - the new App test
  - the updated pull test, which now expects the new cue text

  The other 6 in the new suite guard existing behaviour and passed on both: writes, denial, sign-out, account change, a late response and offline misses.

- **Updated tests:**
  - Two offline tests now use an explicit Retry instead of reopening the same Group instantly.
  - Three App tests advance the clock past the window before a foreground event.
  - The quiet cue assertions now expect "Saved {time} · updating".

## Review fixes

The independent review of `58787d7` found two P2 issues. Each was reproduced as a public-controller regression that fails at `58787d7` and passes after the fix.

- **An explicit refresh stays explicit when a foreground refresh overlaps it.**
  - **Cause:** a foreground refresh started during a pull reused the Group's still-fresh Expenses and Balances. It also superseded the pull, so the explicit refresh never read them again.
  - **Fix:** explicit refreshes now mark their view as explicit until they finish. That covers a pull, Retry, section Retry and the post-write refresh, for `group:<id>`, `groups` and `home`. While a view is marked, overlapping reads of it never accept freshness and join the pending reads instead.
  - **Regressions:** "keeps a pull explicit when a foreground refresh overlaps it …" ends with 2 Group, 2 Expense and 2 Balance reads, current Expenses and Balances of 31. A Groups/Home variant guards the same rule for Home.
- **Balances follow a pending Month read that may add recurring Expenses.**
  - **Cause:** returning to a recently read Month could read Balances while another Month's Expense read was still pending. That read materializes due recurring Expenses on the server, so the Balances missed it and were never read again, because the superseded read returned without follow-up.
  - **Fix:** every Expense read is tracked until it settles, including superseded ones. When one settles, earlier Balance and Home reads become obsolete: a read still in flight is read again, and a completed one is no longer reused. If that Group is still on screen and nothing else is reading it, Balances are marked as updating and read once more. The selected Month and its Expenses are unchanged.
  - **Why not wait instead:** waiting for pending Expense reads before every Balance read was tried first. It stalled Balances behind any slow superseded read, for up to the 20 s timeout, so the follow-up read replaced it.
  - **Regressions:** "reads Balances only after a pending Month read …" covers a completed Balance read followed by the follow-up read. "reads Balances again when that pending Month read settles while they are still being read" covers an in-flight read being read again. Both end at 31 with September still selected.
- **Checks:** mobile has 279 tests. Workspace typecheck, lint and Prettier passed.

## Not verified here

- **Other environments:** a physical phone, TalkBack, large text and the dark theme were not checked for these states, and staging was not used.
- **Precise device timings:** a dev build on a loaded emulator adds 2–4 s of tap-to-request latency. Timings come from the controller harness; device evidence is request counts and screenshots.
- **Device write evidence:** a confirmed write on the device was not recorded. Invalidation after Expense and Settlement writes is covered by the controller suite and by the real-backend measurement, which confirmed the new Expense appeared after the post-write refresh.
- **Activity:** Activity still reads on every open, so it has no freshness reuse. It does share in-flight reads and follows write invalidation. Reusing Activity can come with #108.
- **Recurring materialization:** a recurring Expense that becomes due mid-session (for example across midnight) can appear up to 30 s late on another Month reused from memory. The first Expense read of each session still materializes before any reuse.
