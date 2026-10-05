# Android render baseline (#177)

The device-independent render baseline for [#177](https://github.com/FireBird1998/splitbook/issues/177), part of the performance and maintainability map [#176](https://github.com/FireBird1998/splitbook/issues/176). It was first recorded on `main` at `9856a1d` (2 October 2026) and **re-recorded on `main` at `7e69be8` (5 October 2026)**, with every component-exporting module under `apps/mobile/src/ui` counted. The device gates (frames, jank, memory, scrolling) are measured in [#194](https://github.com/FireBird1998/splitbook/issues/194), not here.

## How it is measured

`apps/mobile/src/render-profile.test.tsx` renders the real `App` around the real controller and a fake `fetch`, against a fictional ledger. The ledger has 20 Groups and a Household Group with 5 pages each of Expenses and Activity (100 rows each). The App renders through the shared React Native stand-ins in `apps/mobile/src/test-utils/native.ts` (#229). The harness replays each journey and records:

- **Publishes:** controller state changes. On a phone each publish in its own task can commit separately, so this is the **upper bound for device commits**.
- **Commits:** React commits seen by a `<Profiler>` around `App`. The test renderer merges publishes made in one task into one commit, so this is the **lower bound**. Every fake response arrives in a later task, as a network reply would.
- **Component renders:** every render of an exported component, in all 29 modules under `src/ui` that export components. This includes the compact primitives (`CompactText`, `Icon`, `ListRow` and so on) and the `ErrorBoundary` class. This is the main measure of how much of the tree re-renders. Components a module does not export are counted only through the exported components they render.
- **Render time:** the Profiler's `actualDuration`, measured in Node. The harness prints it for comparison only. It is not recorded here: it says nothing reliable about a phone, and on a shared machine it varied by about 1.5× between identical runs.

**Determinism and enforcement:**

- The counts are deterministic. Three runs at `7e69be8` gave identical numbers, and so did runs with `TZ` set to `Pacific/Kiritimati` (UTC+14) and `Pacific/Pago_Pago` (UTC−11).
- The test asserts each count as a ceiling, so a change that renders more fails CI. A ceiling one render too low fails with `Type 20 characters into Description: component renders: expected 3241 to be less than or equal to 3240`.
- **A guard test** fails when a module under `src/ui` exports a component the harness doesn't count, and names the module and component. `vi.mock` is hoisted and takes static paths, so the instrumented list is kept by hand at the top of the test file. The guard also fails when a `vi.mock` names a module that no longer exists.

## Re-recording the ceilings

Inside `apps/mobile`:

```sh
RENDER_PROFILE=1 npx vitest run src/render-profile.test.tsx --reporter=default        # print the table and check the ceilings
RENDER_PROFILE=record npx vitest run src/render-profile.test.tsx --reporter=default   # print the table without checking
```

`--reporter=default` keeps the printed table: some automated environments select a quieter Vitest reporter that hides output from passing tests.

1. Run with `RENDER_PROFILE=record` on the commit you are measuring.
2. Copy the counts into `ceilings` in `render-profile.test.tsx`.
3. Update the baseline table below with the commit.
4. Lowering a ceiling needs no reason. Raising one needs the reason in the pull request and in this file (#206 adds the owner's re-record label to enforce this).

## Baseline

**Build:** `main` at `7e69be8` (`docs(adr): mark ADR 0006 accepted (#269)`), with this harness. Node 22.22.2, React 19.2.3, `react-test-renderer` 19.2.3, Vitest 4.1.10. Counted modules: 29.

| Journey                                       | Publishes | Commits | Component renders | Distinct components | Most rendered                               |
| --------------------------------------------- | --------: | ------: | ----------------: | ------------------: | ------------------------------------------- |
| Sign in and show Home (20 Groups)             |         9 |       5 |               461 |                  25 | CompactText 148, Icon 68, ListRow 60        |
| Foreground on Home within 30 s                |         6 |       1 |               146 |                  19 | CompactText 49, Icon 22, ListRow 20         |
| Open a Group on Expenses                      |        11 |       4 |               512 |                  24 | CompactText 155, Icon 82, ListRow 48        |
| Change Month                                  |         8 |       3 |               468 |                  24 | CompactText 141, Icon 73, ListRow 46        |
| Switch to Balances                            |         1 |       1 |                57 |                  21 | CompactText 21, Icon 8, IconButton 3        |
| Switch to Activity                            |         4 |       3 |               173 |                  19 | CompactText 92, CompactAvatar 20, Icon 16   |
| Load the 5th Expense page (80 → 100 rows)     |         7 |       3 |             2,147 |                  21 | CompactText 624, Icon 313, ListRow 286      |
| Foreground within 30 s after 5 Expense pages  |         7 |       1 |               204 |                  21 | CompactText 62, Icon 31, ListRow 22         |
| Load the 5th Activity page (80 → 100 events)  |         3 |       2 |               811 |                  17 | CompactText 573, CompactAvatar 180, Icon 16 |
| Foreground within 30 s after 5 Activity pages |         5 |       2 |               572 |                  17 | CompactText 393, CompactAvatar 120, Icon 16 |
| Type 20 characters into Description           |        40 |      21 |             3,241 |                  29 | CompactText 1,700, Icon 300, FieldError 180 |

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
5. **Switching destination is cheap.** Balances costs 57 renders, and Activity costs 173 with its first page.

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
- Components that a module does not export, such as `ExpenseRow`, `ActivityRow` and Home's `GroupRow`, are counted only through the exported components they render.

## Next

- Each #178 pull request lowers the ceilings to its new numbers and updates the baseline table.
- #206 adds request counts per journey, moves the ceilings into one data file and enforces the re-record label.
- #219 and #222 re-record the foreground-after-pages journeys when a refresh keeps the loaded pages.
