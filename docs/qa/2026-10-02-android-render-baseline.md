# Android render baseline (#177)

Baseline for [#177](https://github.com/FireBird1998/splitbook/issues/177), part of the performance and maintainability map [#176](https://github.com/FireBird1998/splitbook/issues/176). It is measured on `main` at `9856a1d` with the harness added in this change. **Only the device-independent half is done.** No Android phone or emulator was available, so the on-device numbers are still open (see [Not verified](#not-verified)).

## How it is measured

`apps/mobile/src/render-profile.test.tsx` renders the real `App` against a fictional ledger. The ledger has 20 Groups and a Household Group with 5 pages each of Expenses and Activity (100 rows each). The harness replays each journey and records:

- **Publishes:** controller state changes. On a phone each publish in its own task can commit separately, so this is the **upper bound for device commits**.
- **Commits:** React commits seen by a `<Profiler>` around `App`. The test renderer cannot schedule microtasks, so publishes in one task merge into one commit. This is the **lower bound**. Every fake response arrives in a later task, as a network reply would.
- **Component renders:** each time any exported component of the 23 UI modules renders, including the shared primitives (`CompactText`, `Icon`, `Copy`, `ListRow` and so on). This is the main measure of how much of the tree re-renders. Components a module does not export are not counted.
- **Render time:** the Profiler's `actualDuration`, measured in Node. It is reported for comparison only, because it says nothing reliable about a phone.

**Determinism and enforcement:**

- The counts are deterministic: two runs gave identical numbers.
- The test asserts each one as a ceiling, so a change that renders more fails CI. A ceiling one render too low failed with `component renders: expected 2780 to be less than or equal to 2779`.
- Inside `apps/mobile`, run `RENDER_PROFILE=1 npx vitest run src/render-profile.test.tsx` to print the table. Use `RENDER_PROFILE=record` to print it without checking the ceilings, when lowering them.

## Baseline

| Journey                                       | Publishes | Commits | Component renders | Distinct components | Render time (Node, ms) | Most rendered                               |
| --------------------------------------------- | --------: | ------: | ----------------: | ------------------: | ---------------------: | ------------------------------------------- |
| Sign in and show Home (20 Groups)             |         9 |       5 |               649 |                  11 |                   42.2 | Copy 357, Icon 194, GroupCard 60            |
| Foreground on Home within 30 s                |         4 |       1 |               209 |                  10 |                    7.0 | Copy 116, Icon 64, GroupCard 20             |
| Open a Group on Expenses                      |        11 |       4 |               512 |                  25 |                   31.9 | CompactText 159, Icon 74, ListRow 46        |
| Change Month                                  |         8 |       3 |               492 |                  24 |                   22.1 | CompactText 153, Icon 70, ListRow 46        |
| Switch to Balances                            |         1 |       1 |                61 |                  20 |                    4.6 | CompactText 25, Icon 7, Card 4              |
| Switch to Activity                            |         4 |       3 |               192 |                  19 |                   16.2 | CompactText 100, CompactAvatar 22, Icon 14  |
| Load the 5th Expense page (80 → 100 rows)     |         7 |       3 |             2,159 |                  23 |                   30.5 | CompactText 636, Icon 310, ListRow 286      |
| Foreground within 30 s after 5 Expense pages  |         5 |       1 |               208 |                  23 |                    3.6 | CompactText 66, Icon 30, ListRow 22         |
| Load the 5th Activity page (80 → 100 events)  |         3 |       2 |               821 |                  17 |                   50.0 | CompactText 581, CompactAvatar 182, Icon 14 |
| Foreground within 30 s after 5 Activity pages |         3 |       2 |               584 |                  18 |                   26.2 | CompactText 401, CompactAvatar 122, Icon 15 |
| Type 20 characters into Description           |        40 |      20 |             2,780 |                  26 |                   65.3 | CompactText 1,380, Icon 240, Copy 200       |

## Findings

1. **Typing re-renders the whole Expense screen on every keystroke.**
   - Each character costs 2 publishes (the draft and its local save) and about 139 component renders across 26 components. Only the Description field and the Save bar need to change.
   - On a phone that can be up to 40 commits of the whole screen for 20 characters.
   - #148 (status flicker) is a visible symptom of the same publishes. #178's selector subscriptions and memoized screens are the fix.
2. **Loading one more page re-renders every row already on screen, more than once.**
   - The 5th Expense page costs 2,159 renders over 3 commits: all 100 rows re-render about 3 times to add 20.
   - The 5th Activity page costs 821.
   - The cost grows with every page loaded. #179 (virtualized lists) and memoized rows (#178) address it.
3. **A refresh that changes nothing still redraws everything.** A foreground event on Home within the freshness window publishes 4 times and re-renders all 20 Group cards (209 renders), although the figures are identical.
4. **An automatic refresh shrinks a long list back to its first page.** After loading 5 pages, a foreground event within 30 s shows only the first 20 Expenses again. The refreshed screen renders 22 `ListRow`s, where it rendered 102 (100 Expenses) before. This follows #104's rule that later refreshes start from the first page, but the member loses their place. Raise it with #179 and #145 rather than treating it as a render cost.
5. **Switching destination is cheap.** Balances costs 61 renders, and Activity costs 192 with its first page.

## Proposed budget

These are proposals for the owner to confirm in #177.

| Journey                                        | Baseline                                      | Proposed budget                                                  |
| ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Typing, per keystroke                          | about 139 renders                             | **≤ 15** renders (field, Save bar, top-bar status)               |
| Loading one more page                          | renders every mounted row (2,159 at 100 rows) | proportional to the **new page only** (≤ 300 at any list length) |
| Refresh with no changes                        | 209 renders on Home                           | **0** screen re-renders                                          |
| Device: typing at about 10 characters a second | not measured                                  | janky frames ≤ 5%, p90 frame time ≤ 16.7 ms on a low-end phone   |
| Device: scrolling 100+ rows                    | not measured                                  | at least 55 fps (p90) on a low-end phone                         |

## Device protocol (not run here)

For whoever has a low-end Android phone (4 GB RAM or less) or the emulator:

1. Build and install a release (Hermes) build pointed at `apps/mobile/scripts/dev-backend`, signed in with a fictional persona. Seed the same shape as the harness: 20 Groups, and 5 pages of Expenses and Activity.
2. For each journey above, reset the frame stats, perform the journey, then read them:
   - `adb shell dumpsys gfxinfo com.splitbook.app reset`
   - perform the journey
   - `adb shell dumpsys gfxinfo com.splitbook.app framestats`
   - Record the janky-frame percentage and the p50, p90 and p99 frame times.
3. Record one Perfetto trace of a 20-character typing burst, and one React DevTools Profiler session for typing and for loading the 5th page (commit count and the longest commit).
4. Add the numbers to this file with the device model, Android version, build identity and date.

## Not verified

- **No device or emulator numbers.** This environment has no Android SDK, `adb`, emulator or KVM. Frame times, jank and real commit counts are still open, and they decide whether #178 and #179 meet the budget.
- Render times above come from Node and are not comparable with a phone.
- Components that a module does not export (for example, Activity's internal row) are counted only through the exported primitives they render.

## Next

- #178 targets findings 1 and 3. #179 targets finding 2. Each should lower the ceilings in `render-profile.test.tsx` and update this table.
- **Maintainability note (for #182):** every rendered test file defines its own React Native mock. There are 12 copies, including this harness. A shared test-support module would remove them.
