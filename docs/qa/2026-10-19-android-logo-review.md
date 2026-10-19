# Android logo review verification

19 October 2026. Issue #605, PR #627. Fictional data only.

## Behavior and scope

Home and Sign in use the canonical generated light/dark logo at 32 dp. Sign in retains the original copy order: the invited-account explanation precedes Google. The duplicate app-level tile and typed wordmark are absent wherever Sign in displays the logo; its Back action is retained when applicable.

The typed wordmark remains only in the authentication fallback screens: Build setup needed, Checking your session, Couldn’t check your session, and Couldn’t sign out of the server. Home and Sign in show the image instead. No authentication, ledger, storage or HTTP contract changes were made.

The logo dimensions are defined once in `brandLogoSize`. Home reserves 258.25 dp for the logo, gutters, gaps and two 48 dp actions, leaving at most 101.75 dp for its status on a 360 dp phone. The status stays on one line and shrinks inside that bound, including at 200% text.

## Committed behavioral proof

The following six cases in `apps/mobile/src/ui/home.test.tsx` failed against main’s original Home implementation, with no logo node found, and passed after restoring the implementation. Main’s Home implementation is identical at `4422af02` and `fcad6568`.

- `Home top bar > shows the 'light' artwork once as the fixed-size Splitbook heading at 1 text`
- `Home top bar > shows the 'light' artwork once as the fixed-size Splitbook heading at 1.3 text`
- `Home top bar > shows the 'light' artwork once as the fixed-size Splitbook heading at 2 text`
- `Home top bar > shows the 'dark' artwork once as the fixed-size Splitbook heading at 1 text`
- `Home top bar > shows the 'dark' artwork once as the fixed-size Splitbook heading at 1.3 text`
- `Home top bar > shows the 'dark' artwork once as the fixed-size Splitbook heading at 2 text`

The committed review regressions also failed before their fixes:

- `keeps the invited-account explanation before the Google button`: explanation followed the button.
- `shows Sign in branding once without the old tile or typed wordmark`: the old text and tile were still rendered.
- `Home says what is true, without jumps (#332) > keeps the status beside the logo on one line, at 1× text`
- `Home says what is true, without jumps (#332) > keeps the status beside the logo on one line, at 1.3× text`
- `Home says what is true, without jumps (#332) > keeps the status beside the logo on one line, at 2× text`

The three status cases hold the real controller’s reads at the network edge, assert the measured fixed width and explicit status bound, and observe Checking… then Updating…. There is no skipped 200% width assertion. The tests remain in the repository; red logs and media do not.

## Device verification

A separate Android 35 AVD, `sb605-review` / `emulator-5570`, used 1080×1920 pixels at density 480: 360×640 dp. The shared emulator-5554 was not operated. Home used fictional Alex Rivera on an isolated local backend. Google’s native button used a fictional nonresolving staging configuration; Google authentication was not attempted.

The before/after matrix covers Home and Sign in at 100%, 130% and 200% text, in light and dark. Every after case has one logo node, 96 physical pixels high (32 dp). Separate 200% captures in both appearances show Updating… beside the logo.

At 200%, the status rectangle is `[463,117][767,219]`, Refresh is `[774,96][918,240]`, and Account is `[924,96][1068,240]`. Both actions remain within the 1080 px screen; the status stops before Refresh. These rectangles match in both appearances.

The first-screen Google button measurements are the same in light and dark:

| Text scale | Main before: button bounds | After: button bounds  | Result                                                                                                        |
| ---------- | -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| 100%       | `[93,1092][987,1236]`      | `[93,1020][987,1164]` | Entire 48 dp button is visible.                                                                               |
| 130%       | `[93,1312][987,1456]`      | `[93,1240][987,1384]` | Entire 48 dp button is visible.                                                                               |
| 200%       | `[93,1786][987,1848]`      | `[93,1705][987,1848]` | The content edge clips 1 physical pixel of the after button’s 144 px height; a small scroll reveals it fully. |

A scrolled 200% capture measures the full button at `[93,1485][987,1629]` (144 px / 48 dp). The owner accepts scrolling at 200%; copy order, font scaling, spacing and typography were not reflowed to force a fit. Native accessibility trees and screen tests verify the single named logo and Home heading role; spoken TalkBack audio was not recorded.

The [27 screenshots are attached to the PR](https://github.com/FireBird1998/splitbook/pull/627#issuecomment-6256780670) through its upload interface, not stored in Git. The pre-existing balances-card heading wrapping at 200% remains outside this ticket.

## Post-rebase checks

The focused Home, Sign in, app-states, render-profile and financial-views suite passed all 140 tests after rebasing onto `fcad6568`. The brand exporter regenerated and verified 158 assets, preserving the web maskable outputs from #625. Formatting, lint and typecheck passed.

The full `pnpm swarm gate --mongo-port 27605` then passed all 18 steps on a fresh isolated backend, including workspace unit tests, render ceilings and every mobile HTTP verifier. The backend was stopped and its database dropped after the checks.
