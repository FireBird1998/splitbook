# Android render and request baseline (#177, #206)

The device-independent render baseline for [#177](https://github.com/FireBird1998/splitbook/issues/177), part of the performance and maintainability map [#176](https://github.com/FireBird1998/splitbook/issues/176). It was first recorded on `main` at `9856a1d` (2 October 2026) and **re-recorded on `main` at `7e69be8` (5 October 2026)**, with every component-exporting module under `apps/mobile/src/ui` counted. [#206](https://github.com/FireBird1998/splitbook/issues/206) added a request count to every journey, six journeys for the reads ADR 0006 changes, one data file for every ceiling, and the ratchet that keeps a ceiling from rising without an approver's label; it **recorded on `main` at `d506f6e` (5 October 2026)**. The device gates (frames, jank, memory, scrolling) are measured in [#194](https://github.com/FireBird1998/splitbook/issues/194), not here.

## How it is measured

`apps/mobile/src/render-profile.test.tsx` renders the real `App` around the real controller and a fake `fetch`, against a fictional ledger. The ledger has 20 Groups and a Household Group with 5 pages each of Expenses and Activity (100 rows each). The App renders through the shared React Native stand-ins in `apps/mobile/src/test-utils/native.ts` (#229). The harness replays each journey and records:

- **Publishes:** controller state changes. On a phone each publish in its own task can commit separately, so this is the **upper bound for device commits**.
- **Commits:** React commits seen by a `<Profiler>` around `App`. The test renderer merges publishes made in one task into one commit, so this is the **lower bound**. Every fake response arrives in a later task, as a network reply would.
- **Requests:** each request the fake `fetch` receives during the journey, by method and path (with its query). Counts come only from the fake `fetch` and `controller.subscribe`, never from the controller's internals.
- **Component renders:** each render of an exported component that another module makes through the export, in all 29 modules under `src/ui` that export components. This includes the compact primitives (`CompactText`, `Icon`, `ListRow` and so on) and the `ErrorBoundary` class. It is the main measure of how much of the tree re-renders, and a **lower bound**: the harness wraps each module's exports, so renders from inside a component's own module, and components a module doesn't export, are not counted (see [Not verified](#not-verified)).
- **Render time:** the Profiler's `actualDuration`, measured in Node. The harness prints it for comparison only. It is not recorded here: it says nothing reliable about a phone, and on a shared machine it varied by about 1.5× between identical runs.

**Determinism and enforcement:**

- The counts are deterministic. Three runs at `d506f6e` gave identical numbers, and so did runs with `TZ` set to `Pacific/Kiritimati` (UTC+14) and `Pacific/Pago_Pago` (UTC−11). Only the Expense reads' `dateFrom` and `dateTo` change with the zone, because a Month is a calendar month in the viewer's zone; the counts don't.
- **Every ceiling is in one data file**, `apps/mobile/src/render-profile.ceilings.json`: the request, publish, commit and render ceilings of each journey. The test reads it, and so does the ratchet (below), so nothing parses test code. A journey without a ceiling fails, and the last test fails when the file has a ceiling for a journey that didn't run.
- The test asserts each count as a ceiling, so a change that renders more or sends more fails CI. A ceiling one render too low fails with `Foreground on Home within 30 s: renders: expected 146 to be less than or equal to 145`. One more request fails the same way: checked by hand with a Balances refresh added to a journey (not committed), which failed with `Switch to Balances: requests: expected 1 to be less than or equal to 0`. Every journey in a test still runs and reports its counts before the test fails.
- **A journey that only reads sends nothing but GETs.** Opening, going back, refreshing, returning to the foreground, switching destination and loading a page never resume or replay a write (ADR 0004), so any other request fails the journey and names it. Checked by hand with a sign-out added to a read journey (not committed): `Back to Home from a Group only reads, so it may send nothing but GETs: expected [ 'POST /api/auth/sign-out' ] to deeply equal []`. The sign-in journey may send exactly one other request, `POST /api/auth/demo-persona/sign-in`, matched on method and path; any other non-GET fails it too. Checked by hand (not committed) by recording Home's totals read as a `PUT`: `Sign in and show Home (20 Groups) may send nothing but GETs and POST /api/auth/demo-persona/sign-in: expected [ 'PUT /api/user/balances', …(1) ] to deeply equal []`. Typing into the Expense form sends nothing at all.
- **The ceilings have no headroom.** They equal the recorded counts, which depend on the order in which the fake responses arrive. Each response waits one `setTimeout(0)`, so the order is fixed and the counts are stable, but a Node or React scheduler upgrade could move a commit by one. If that happens, re-record and say why in this file.
- **Each journey checks the screen it ends on** before its counts are compared: the Group rows on Home, the Month and the Expense rows, the Balances, the Activity rows, or the typed Description with "Draft saved". A journey that breaks fails there instead of passing by rendering less. Checked by hand at `d506f6e`: with the fake Expenses endpoint answering 500, all five journey tests fail.
- **Any console error fails the test**, except the two this file causes on purpose: React's warning that the environment doesn't support `act(...)` (the harness renders outside `act()` so publishes commit as they would on a device) and the `react-test-renderer` deprecation notice.
- When a count comes in under its ceiling, the test prints a warning naming the journey, the measure, the count and the ceiling, so the ceiling can come down: `Change Month: requests 2 is under its ceiling of 3; lower the ceiling.` It prints nothing otherwise.
- **A guard test** fails when a module under `src/ui` exports a component the harness doesn't count, and names the module and component. `vi.mock` is hoisted and takes static paths, so the instrumented list is kept by hand at the top of the test file. The guard also fails when a `vi.mock` names a module that no longer exists.
- **The ratchet.** No pull request may raise a ceiling, or remove or rename a journey, unless an approver allows it with the `re-record-ceilings` label. PR checks ends with `pnpm mobile ceilings:compare` against the base's copy of the data file, and accepts the label only when the pull request has it and the latest `labeled` event for it on the pull request's timeline was made by an account in the repository variable `CEILINGS_APPROVERS` (default: the repository owner). Lowering a ceiling or adding a journey always passes. `pnpm swarm gate` runs the same script against the merge-base, so an agent sees a raised ceiling before CI does (`tools/swarm/README.md`).

## Re-recording the ceilings

From the repository root:

```sh
RENDER_PROFILE=1 pnpm mobile exec vitest run src/render-profile.test.tsx --reporter=default        # print the tables and check the ceilings
RENDER_PROFILE=record pnpm mobile exec vitest run src/render-profile.test.tsx --reporter=default   # print the tables and the data file, without checking
pnpm mobile ceilings:compare --base "$(git merge-base HEAD origin/main)"                          # what the ratchet will say
```

`--reporter=default` keeps the printed tables: some automated environments select a quieter Vitest reporter that hides output from passing tests. `RENDER_PROFILE=record` skips every ceiling, so the test refuses to run with it when `CI` is set.

1. Run with `RENDER_PROFILE=record` on the commit you are measuring, the whole file at once. The end-screen and GET-only checks still run. It prints the counts table, the requests each journey sent, and `src/render-profile.ceilings.json` as these counts would make it.
2. Update the data file, `apps/mobile/src/render-profile.ceilings.json`, from the printed file. A new journey needs its own entry, or the test fails.
3. Update the tables below with the commit, and run `ceilings:compare` to see what changed.
4. Lowering a ceiling or adding a journey needs no reason and no label.
5. Raising a ceiling, or removing or renaming a journey, is a re-record:
   - explain why in the pull request, and in this file, for each ceiling that rose;
   - ask an approver for the `re-record-ceilings` label. It must be on the pull request and applied by an account in the repository variable `CEILINGS_APPROVERS` (default: the repository owner). If anyone else applies it, the check stays red and names who applied it, and an approver removes the label and applies it again. Adding the label reruns PR checks, which then pass;
   - an approver approves each re-record on its own pull request, so a later pull request needs the label again.

Re-records already planned: a refresh re-reads the loaded pages, up to 5 (ADR 0006), so the refresh journeys send more requests. #219 did it for Expenses ([below](#re-recorded-for-219)); #222 (Activity) still will. No journey measured an Expense's history before #220, so #220 added its journeys instead ([below](#added-for-220)).

## Baseline

**Build:** `main` at `d506f6e` (`CI: one fast PR check; the full suite nightly and on demand (#277) (#279)`), with #206's harness. Node 22.22.2, React 19.2.3, `react-test-renderer` 19.2.3, Vitest 4.1.10. Counted modules: 29. The 11 journeys recorded at `7e69be8` count the same at `d506f6e`, so their render ceilings didn't change; the 6 journeys #206 added, and every request count, were first recorded at `d506f6e`. No journey moved the harness clock before #206; the two "after 30 s" journeys move it 31 s, and #214 moves that to fake timers once freshness follows `Date.now`.

**The data file is authoritative**; this table follows it. The pilot ([#218](https://github.com/FireBird1998/splitbook/issues/218)) lowered two publish counts after `d506f6e`: Sign in and show Home from 9 to 8, and Foreground on Home within 30 s from 6 to 2. Both rows show `main`'s data file.

| Journey                                       | Requests | Publishes | Commits | Component renders | Distinct components | Most rendered                               |
| --------------------------------------------- | -------: | --------: | ------: | ----------------: | ------------------: | ------------------------------------------- |
| Sign in and show Home (20 Groups)             |        7 |         8 |       5 |               461 |                  25 | CompactText 148, Icon 68, ListRow 60        |
| Foreground on Home within 30 s                |        0 |         2 |       1 |               146 |                  19 | CompactText 49, Icon 22, ListRow 20         |
| Open a Group on Expenses                      |        3 |        11 |       4 |               512 |                  24 | CompactText 155, Icon 82, ListRow 48        |
| Change Month                                  |        2 |         8 |       3 |               468 |                  24 | CompactText 141, Icon 73, ListRow 46        |
| Switch to Balances                            |        0 |         1 |       1 |                57 |                  21 | CompactText 21, Icon 8, IconButton 3        |
| Switch to Activity                            |        1 |         4 |       3 |               173 |                  19 | CompactText 92, CompactAvatar 20, Icon 16   |
| Load the 5th Expense page (80 → 100 rows)     |        2 |         7 |       3 |             2,147 |                  21 | CompactText 624, Icon 313, ListRow 286      |
| Foreground within 30 s after 5 Expense pages  |        0 |         7 |       1 |               204 |                  21 | CompactText 62, Icon 31, ListRow 22         |
| Load the 5th Activity page (80 → 100 events)  |        1 |         3 |       2 |               811 |                  17 | CompactText 573, CompactAvatar 180, Icon 16 |
| Foreground within 30 s after 5 Activity pages |        1 |         5 |       2 |               572 |                  17 | CompactText 393, CompactAvatar 120, Icon 16 |
| Back to Home from a Group                     |        1 |         5 |       2 |               294 |                  20 | CompactText 98, Icon 45, ListRow 40         |
| Reopen the Group within 30 s                  |        0 |         6 |       1 |               204 |                  21 | CompactText 62, Icon 31, ListRow 22         |
| Pull to refresh with 5 Expense pages          |        3 |        13 |       4 |             1,932 |                  21 | CompactText 566, Icon 284, ListRow 248      |
| Foreground after 30 s with 5 Expense pages    |        3 |        13 |       4 |             1,932 |                  21 | CompactText 566, Icon 284, ListRow 248      |
| Pull to refresh with 5 Activity pages         |        1 |         5 |       2 |               572 |                  17 | CompactText 393, CompactAvatar 120, Icon 16 |
| Foreground after 30 s with 5 Activity pages   |        1 |         5 |       2 |               572 |                  17 | CompactText 393, CompactAvatar 120, Icon 16 |
| Type 20 characters into Description           |        0 |        40 |      21 |             3,241 |                  29 | CompactText 1,700, Icon 300, FieldError 180 |

### Re-recorded for #219

**Build:** `swarm/219-group-queries`, rebased on `main` (7 October 2026), recorded three times with `RENDER_PROFILE=record`; the three runs gave identical counts. A Group's Expenses and Balances moved to declarative queries (ADR 0006): a refresh re-reads the loaded Expense pages (M1-3), a list slides past 5 pages (M7-2), each Expense row renders again only when its Expense changes, and the Group view publishes only when what it shows changes. The "after 30 s" journeys move both the harness clock and, with fake timers, `Date.now`, which the Group view's queries follow.

Publishes / commits / component renders, and requests, for every journey whose count moved, and the two journeys #219 added. Every other journey counts as `main`'s data file has it, which the table above shows.

| Journey                                      | Requests | Before (`d506f6e`) |         #219 | Why                                                                      |
| -------------------------------------------- | -------: | -----------------: | -----------: | ------------------------------------------------------------------------ |
| Open a Group on Expenses                     |        3 |       11 / 4 / 512 |  9 / 3 / 312 | rows render once; the Group and its Expenses are read together           |
| Change Month                                 |        2 |        8 / 3 / 468 |  5 / 3 / 325 | the view publishes only what changed                                     |
| Load the 5th Expense page (80 → 100 rows)    |        2 |      7 / 3 / 2,147 |  5 / 3 / 327 | only the new page's 20 rows render                                       |
| Foreground within 30 s after 5 Expense pages |        0 |        7 / 1 / 204 |   2 / 1 / 62 | the 100 rows stay, and none renders again                                |
| Reopen the Group within 30 s                 |        0 |        6 / 1 / 204 |  4 / 1 / 204 | the view publishes only what changed                                     |
| Pull to refresh with 5 Expense pages         |    3 → 7 |     13 / 4 / 1,932 | 10 / 4 / 248 | **re-record:** re-reads the 5 loaded pages and keeps the rows (M1-3)     |
| Foreground after 30 s with 5 Expense pages   |    3 → 7 |     13 / 4 / 1,932 |  8 / 4 / 248 | **re-record:** re-reads the 5 loaded pages and keeps the rows (M1-3)     |
| Load the 6th Expense page (pages 2 to 6)     |        2 |              (new) |  5 / 3 / 331 | Load more past 5 pages drops the newest; pages keep their rows by number |
| Load newer Expenses (pages 1 to 5)           |        2 |              (new) |  5 / 3 / 331 | Load newer reads page 1 and drops page 6                                 |

**The two request ceilings that rose** are the re-record ADR 0006 planned: a pull, and a foreground after 30 s, with 5 Expense pages loaded each send the Group and Expenses page 1 together, then Expenses pages 2 to 5, then Balances, 7 requests instead of 3. The owner applies `re-record-ceilings` on #219's pull request. Every other change lowers a ceiling.

The two journeys #219 added send, in order: Expenses page 6 then Balances, and Expenses page 1 then Balances (Balances follow every Expense read, finding 6).

Rebased on #331's loading motion (`d41424b`), one count moved: Change Month renders 325, not 328, with #331's Month summary skeleton. Its ceiling came down; no other count moved.

### Added for #220

**Build:** `swarm/220-expense-record-queries`, on `main` at `a948168`, recorded with `RENDER_PROFILE=record`. An Expense record and its history moved to declarative queries (ADR 0006): the record is read beside its Group, a refresh re-reads the pages of changes already loaded (M1-3), and the changes slide past 5 pages, with Load newer (M7-2). The harness serves each Expense's record and 6 pages of its changes. No existing journey's count moved; the four journeys below are new, so they need no re-record.

| Journey                                                  | Requests | Publishes / commits / renders | Sent, in order                                                               |
| -------------------------------------------------------- | -------: | ----------------------------: | ---------------------------------------------------------------------------- |
| Open an Expense from Expenses                            |        3 |                   5 / 3 / 261 | Group and the record together, then the changes' page 1                      |
| Refresh an Expense with 2 pages of changes               |        5 |                   5 / 5 / 331 | the session check, Group, the record, then the changes' pages 1 and 2 (M1-3) |
| Load the 6th page of an Expense’s changes (pages 2 to 6) |        1 |                   2 / 2 / 238 | the changes' page 6; page 1 drops                                            |
| Load newer changes (pages 1 to 5)                        |        1 |                   2 / 2 / 240 | the changes' page 1; page 6 drops                                            |

A change's row is drawn again only when what it says changes, so a slide or a refresh draws only the changes it adds. Refresh publishes once more than first recorded: the top bar says "Refreshing…" from the tap, before the session check (the device check of #220).

### Added for #333

**Build:** `swarm/333-reads-together`, on `main` at `907b147`, recorded three times with `RENDER_PROFILE=record`; the three runs gave identical counts. Under load (the gate runs every workspace at once), Record a payment sometimes commits once more and renders one more component, so its ceiling is the higher pair, 7 and 469; its 6 requests never vary. Home reads its Groups list and its figures together, the Record payment sheet checks the Group its view verified within 30 s and reads only its Balances, and Record reads only the Balances before the payment. The harness's `payment` backend adds Alex to Maple House, so Sam can record the payment Balances suggest, and answers the payment. Requests stay as before for every existing journey; one ceiling is lowered and two journeys are new, so nothing needs a re-record.

| Journey                            | Requests | Publishes / commits / renders | Sent, in order                                                                                                   |
| ---------------------------------- | -------: | ----------------------------: | ---------------------------------------------------------------------------------------------------------------- |
| Sign in and show Home (20 Groups)  |        7 | 8 / 4 / 319 (was 8 / 5 / 461) | as before; Home's list and figures are read together: one commit fewer                                           |
| Open the payment sheet within 30 s |        1 |                   3 / 2 / 196 | Balances                                                                                                         |
| Record a payment                   |        6 |      13 / 6 to 7 / 468 to 469 | Balances, `POST /api/groups/:id/settlements`, then Group, Expenses page 1, Balances and `GET /api/user/balances` |

### Requests per journey

What each journey sends, in order, at `d506f6e`. `:id` is the Household Group's id. **Group** is `GET /api/groups/:id`; **Balances** is `GET /api/groups/:id/balances`; **Expenses page N** is `GET /api/groups/:id/expenses?page=N&limit=20&includeMemberBreakdown=1` with the Month on screen as `dateFrom` and `dateTo`; **Activity page N** is `GET /api/groups/:id/activity?page=N&limit=20`. Every request but the persona sign-in is a GET.

| Journey                                       | Requests | Sent, in order                                                                                                                                                                                                     |
| --------------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign in and show Home (20 Groups)             |        7 | `POST /api/auth/demo-persona/sign-in`, `GET /api/auth/get-session`, `GET /api/groups`, `GET /api/user/balances`; then the App's restore on mount sends `get-session`, `/api/groups` and `/api/user/balances` again |
| Foreground on Home within 30 s                |        0 | none                                                                                                                                                                                                               |
| Open a Group on Expenses                      |        3 | Group, Expenses page 1 (September), Balances                                                                                                                                                                       |
| Change Month                                  |        2 | Expenses page 1 (August), Balances                                                                                                                                                                                 |
| Switch to Balances                            |        0 | none                                                                                                                                                                                                               |
| Switch to Activity                            |        1 | Activity page 1                                                                                                                                                                                                    |
| Load the 5th Expense page (80 → 100 rows)     |        2 | Expenses page 5, Balances                                                                                                                                                                                          |
| Foreground within 30 s after 5 Expense pages  |        0 | none                                                                                                                                                                                                               |
| Load the 5th Activity page (80 → 100 events)  |        1 | Activity page 5                                                                                                                                                                                                    |
| Foreground within 30 s after 5 Activity pages |        1 | Activity page 1                                                                                                                                                                                                    |
| Back to Home from a Group                     |        1 | `GET /api/user/balances`                                                                                                                                                                                           |
| Reopen the Group within 30 s                  |        0 | none                                                                                                                                                                                                               |
| Pull to refresh with 5 Expense pages          |        3 | Group, Expenses page 1, Balances                                                                                                                                                                                   |
| Foreground after 30 s with 5 Expense pages    |        3 | Group, Expenses page 1, Balances                                                                                                                                                                                   |
| Pull to refresh with 5 Activity pages         |        1 | Activity page 1                                                                                                                                                                                                    |
| Foreground after 30 s with 5 Activity pages   |        1 | Activity page 1                                                                                                                                                                                                    |
| Type 20 characters into Description           |        0 | none                                                                                                                                                                                                               |

The sign-in journey's 7 include the harness's order of events: it signs in through the controller before it mounts the App, so the App's own restore (`apps/mobile/App.tsx:107`) reads the session, the Groups and Home's totals a second time. On a phone the restore runs when the App opens, before anyone signs in.

### Changes since the first record

Publishes / commits / component renders. The first record counted 23 modules; this one counts 29. "App changes" is how much the renders of the first record's modules moved between the two commits; "Newly counted" is what the modules added to the list count at `7e69be8`.

| Journey                                       | `9856a1d` (2 Oct) | `7e69be8` (5 Oct) | App changes | Newly counted |
| --------------------------------------------- | ----------------: | ----------------: | ----------: | ------------: |
| Sign in and show Home (20 Groups)             |       9 / 5 / 649 |       9 / 5 / 461 |        −204 |           +16 |
| Foreground on Home within 30 s                |       4 / 1 / 209 |       6 / 1 / 146 |         −67 |            +4 |
| Open a Group on Expenses                      |      11 / 4 / 512 |      11 / 4 / 512 |           0 |             0 |
| Change Month                                  |       8 / 3 / 492 |       8 / 3 / 468 |         −24 |             0 |
| Switch to Balances                            |        1 / 1 / 61 |        1 / 1 / 57 |          −4 |             0 |
| Switch to Activity                            |       4 / 3 / 192 |       4 / 3 / 173 |         −19 |             0 |
| Load the 5th Expense page (80 → 100 rows)     |     7 / 3 / 2,159 |     7 / 3 / 2,147 |         −12 |             0 |
| Foreground within 30 s after 5 Expense pages  |       5 / 1 / 208 |       7 / 1 / 204 |          −4 |             0 |
| Load the 5th Activity page (80 → 100 events)  |       3 / 2 / 821 |       3 / 2 / 811 |         −10 |             0 |
| Foreground within 30 s after 5 Activity pages |       3 / 2 / 584 |       5 / 2 / 572 |         −12 |             0 |
| Type 20 characters into Description           |   40 / 20 / 2,780 |   40 / 21 / 3,241 |        +380 |           +81 |

- **Publishes:** every foreground journey gained 2, from #127's automatic-refresh cue, which publishes once at the start of the refresh and once at the end.
- **Commits:** typing gained one commit (20 → 21).
- **Renders:** Home's Group rows moved from `GroupCard` (removed) to the compact `ListRow` and `IconTile`, and Home renders fewer components in all. The Expense editor now renders 85 `CompactText`s per keystroke, up from 69.
- **Newly counted:** `home`'s four sections on Home (`HomeTopBar`, `HomeBalances`, `ContinueDrafts`, `HomeGroups`), and on the Expense screen `TagSheet`, `SplitSheet`, `PayerSheet` and `ErrorBoundary` (#187), about once per keystroke each. `trip-strip` (Trip Groups only) and `group-members` (the Members screen) render on screens no journey visits. The removed `allocation-editors` is no longer mocked.
- Moving the harness to the shared React Native stand-ins changed no count.

## Findings

Line numbers are at `7e69be8`.

1. **Typing re-renders the whole Expense editor on every keystroke: 162 component renders per keystroke.**
   - The cost sits inside `ExpenseEditor`. The App mounts only the active screen (`apps/mobile/App.tsx:139-149`), and `ExpenseScreen` hands `state.expense` to `ExpenseEditor` (`App.tsx:903-906`), which changes on every keystroke. The App's whole-snapshot subscription (`App.tsx:104`) is not the cause, so a selector at the App level would not reduce typing cost. Selection has to reach the fields (#178).
   - Per keystroke: 85 `CompactText`, 15 `Icon`, 9 `FieldError`, and 5 `BottomSheet`s. The four closed sheets (`TagSheet`, `DateSheet`, `SplitSheet`, `PayerSheet`) and the editor's own options sheet render on every keystroke, although none is open.
   - Each keystroke publishes twice: the draft with `persistence: 'saving'`, then `'saved'` once the device write lands. In the harness both land in one commit; on a phone the second probably commits on its own (#194 measures it).
2. **Loading one more page re-renders every row already on screen.**
   - The 5th Expense page costs 2,147 renders over 3 commits. `ListRow` renders 286 times, about 2.9 times per mounted row, to add 20 rows.
   - The 5th Activity page costs 811.
   - The cost grows with every page loaded. There is no `memo` in `App.tsx` or `src/ui`. Memoized rows (#178) address it first; #179 moves the lists to `FlatList` only if the memoized build misses the device budget in #194.
3. **A refresh that changes nothing still redraws Home.** A foreground event on Home within the freshness window publishes 6 times (2 of them #127's automatic-refresh cue) and renders 146 components, all 20 Group rows included, although nothing changed (#178).
4. **An automatic refresh shrinks a long list back to its first page.** After 5 pages, a foreground event within 30 s shows only the first 20 Expenses again (22 `ListRow`s). This follows #104's rule that a refresh starts from the first page. ADR 0006 (#195) decided it: a refresh re-reads the pages already loaded, up to 5 (#215). It lands per list, in #219 for Expenses and #222 for Activity, and those tickets re-record the two foreground-after-pages journeys.
   - **Fixed for Expenses in #219.** A foreground within 30 s keeps the 100 rows and reads nothing (62 renders); one after 30 s re-reads the 5 loaded pages and keeps the rows. Activity still shrinks until #222.
5. **Switching destination is cheap.** Balances costs 57 renders, and Activity costs 173 with its first page.
6. **Every Expense read also re-reads Balances.** Opening a Group, changing Month and loading the 5th page each end with `GET /api/groups/:id/balances`, because Balances follow Expense reads (ADR 0006). The page load costs 2 requests, not 1.
7. **Activity re-reads its first page on a foreground within 30 s; Expenses don't.** After 5 pages, a foreground within the window sends nothing on Expenses but `GET …/activity?page=1` on Activity, the same request as a pull or a foreground after 30 s. Expenses within 30 s still shrink back to their first page, from memory, without a request (finding 4). Since #219 they keep their 5 pages.
8. **Going back to Home re-reads Home's totals.** Back from a Group sends `GET /api/user/balances` (the Group's Expense reads marked them stale) and redraws Home: 294 renders. Reopening the Group within 30 s sends nothing.
9. **A refresh of 5 loaded pages reads only the first page.** A pull and a foreground after 30 s each send 3 requests on Expenses (Group, Expenses page 1, Balances) and 1 on Activity, and both shrink the list to 20 rows: 1,932 renders on Expenses, 572 on Activity. When a refresh re-reads the loaded pages (#215), these journeys send more; #219 and #222 re-record them.
   - **Re-recorded for Expenses in #219.** A pull and a foreground after 30 s each send 7 requests: the Group and Expenses page 1 together, then pages 2 to 5, then Balances. They keep all 100 rows, and render 248 components, because each row renders again only when its Expense changes. Activity is unchanged until #222.

## Proposed budget

The owner confirms or changes this budget in [#194](https://github.com/FireBird1998/splitbook/issues/194), against the device numbers. #178 takes its targets from the confirmed budget.

| Measure                            | Today (`7e69be8`)                | Proposed budget                                            | Measured by       |
| ---------------------------------- | -------------------------------- | ---------------------------------------------------------- | ----------------- |
| Renders per keystroke              | 162                              | **≤ 15** (the field, the Save bar and the draft status)    | this harness (CI) |
| Renders for a page load            | 2,147 (Expenses), 811 (Activity) | about the **new page only**, ≤ 300 at any list length      | this harness (CI) |
| Screen renders for a no-op refresh | 146 on Home                      | **0**                                                      | this harness (CI) |
| Janky frames                       | not measured                     | ≤ 5%                                                       | #194              |
| Frame rate, p90                    | not measured                     | ≥ 55 fps (p90 frame time ≤ 18.2 ms)                        | #194              |
| Blank area during a fling          | not measured                     | none visible                                               | #194              |
| Return after Back                  | not measured                     | the opened Expense is on screen, at font scale 1.0 and 2.0 | #194              |

## Device gates

[#194](https://github.com/FireBird1998/splitbook/issues/194) measures the same journeys on a low-end phone (4 GB RAM or less) with a release build: frame stats from `dumpsys gfxinfo`, memory after the 5th page, a Perfetto trace of a typing burst, React DevTools Profiler commit times, blank area during a fling, and the return to the same row. It runs in #193's phone session, and again after #178's memoized rows land. Its protocol and record live there.

## Not verified

- **No device numbers.** Frame times, jank, memory and real commit counts belong to #194. They decide whether #178 and #179 meet the budget.
- Render times come from Node and are not comparable with a phone.
- **The component renders are a lower bound.** The harness counts a component only when another module renders it through its export:
  - Renders from inside the component's own module are not counted. Examples: `Skeleton` and `Card` inside `compact/layout.tsx`, `Field` and `FieldError` inside `group-workflows.tsx`, and `Icon`, `Copy` and `Button` inside `primitives.tsx`. A change that adds such renders doesn't move the ceilings.
  - Components that a module does not export, such as `ExpenseRow`, `ActivityRow` and Home's `GroupRow`, are counted only through the exported components they render from other modules.

## Next

- Each #178 pull request lowers the ceilings to its new numbers and updates the baseline table.
- #206 added request counts per journey, the six journeys above, the data file and the ratchet. #214 moves the "after 30 s" journeys to fake timers once freshness follows `Date.now`.
- #222 re-records its refresh journeys, with an approver's `re-record-ceilings` label, when a refresh re-reads the loaded pages; #219 did it for Expenses, and #220 added the Expense record's journeys.
