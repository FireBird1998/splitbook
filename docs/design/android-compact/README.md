# Splitbook Android — compact surface reference

Approved design for the compact native Android surface. The owner reviewed it on 2026-10-01 ([#106](https://github.com/FireBird1998/splitbook/issues/106)), and it is implemented through the [#112](https://github.com/FireBird1998/splitbook/issues/112) spec and its tickets.

**Source:** the [Claude Design canvas](https://claude.ai/artifact/12FHM62to1ytDFqPAnbqrQ), which is private to the owner. The PNGs in [`screens/`](./screens) were rendered from the canvas source on 2026-10-01 at 2× (a 412 × 915 dp phone, plus 360 × 640 dp for the small-display screens), using the app's own Outfit and IBM Plex Mono fonts. When the canvas and this folder disagree, the canvas wins; re-export and update this folder.

Colours are the shared semantic tokens from `@splitbook/shared/design-tokens`, unchanged. This folder documents how the compact surface uses them; it does not define new tokens.

## Screens

### Core flow

| Screen                                                        | What it shows                                                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [Navigation model](./screens/01-navigation-model.png)         | Destinations, where the bottom navigation lives, and the rules for Back and returning after Save                                                |
| [Home](./screens/02-home.png)                                 | Balances by currency, the "Continue where you left off" drafts list (unconfirmed saves first), and Groups with the member's balance on each row |
| [Group · Expenses](./screens/03-group-expenses.png)           | Household Theme: Month bar, Month summary, day-grouped rows showing "you lent" or "you owe", the add button, and the bottom navigation          |
| [Group · Balances](./screens/04-group-balances.png)           | All-time balance, suggested payments with Record, and everyone's net balance                                                                    |
| [Group · Activity](./screens/05-group-activity.png)           | Group-scoped timeline with "Load older activity"                                                                                                |
| [Add expense](./screens/06-add-expense.png)                   | The compact form: Amount and Description card, four tiles, the "Who owes what" table, optional details, and the Save bar                        |
| [Trip Group · Expenses](./screens/27-trip-group-expenses.png) | Trip Theme: slim boarding-pass strip and all-time summary, with no Month bar                                                                    |
| [Expense record](./screens/28-expense-record.png)             | Position badge, allocation, details and history                                                                                                 |
| [Members and details](./screens/31-members-and-details.png)   | Opened from ⋮: Theme, currency, Month lens, members with roles, and Invite                                                                      |
| [Record payment sheet](./screens/30-record-payment-sheet.png) | Pre-filled Settlement, with the overpayment confirmation                                                                                        |
| [After Save](./screens/32-after-save.png)                     | "Expense saved" snackbar and the new row highlighted                                                                                            |

### Expense form: keyboard, corrections and sheets

| Screen                                                                         | What it shows                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [Keyboard open](./screens/07-keyboard-open.png)                                | Amount focused on the decimal keypad; the Save bar rides above the keyboard                |
| [Corrections](./screens/08-corrections.png)                                    | Linked error summary, errors beside each control, no silent rounding or Tag substitution   |
| [Who paid sheet](./screens/09-who-paid-sheet.png)                              | One person or several people, remainder and progress, "Give the rest to …"                 |
| [Split sheet](./screens/10-split-sheet.png)                                    | Equal, Amounts, Percentage and Shares; checkboxes, steppers, rounding note                 |
| [Date sheet](./screens/11-date-sheet.png)                                      | Today and Yesterday, and the built-in month calendar                                       |
| [Tag sheet](./screens/12-tag-sheet.png)                                        | Active Tags only, with search                                                              |
| [Edit, changed by someone else](./screens/29-edit-changed-by-someone-else.png) | Conflict comparison: "Keep my version for review" or "Use the saved version"               |
| [Receipt suggestion](./screens/33-receipt-suggestion.png)                      | Scan icon in the Amount row and the suggestion chip (only while the experiment is enabled) |

### Loading, offline and recovery states

| Screen                                                          | What it shows                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [First load](./screens/13-first-load.png)                       | Skeleton rows and one linear progress bar                                   |
| [Refreshing](./screens/14-refreshing-saved-figures-shown.png)   | Content stays visible, labelled "Saved 10:42 · refreshing"                  |
| [Offline, saved copy](./screens/15-offline-saved-copy.png)      | Offline banner, the saved time, and Record disabled with its reason         |
| [Not available offline](./screens/16-not-available-offline.png) | A Group never opened on this phone: compact message with Try again          |
| [Draft to resume](./screens/17-draft-to-resume.png)             | Info-tone draft banner; the add button becomes "Resume draft"               |
| [Save not confirmed](./screens/18-save-not-confirmed.png)       | Warning tone, locked fields, "Check and finish saving" and "Keep for later" |

### Dark, small display and large text

| Screen                                               | Variant      |
| ---------------------------------------------------- | ------------ |
| [Home](./screens/19-home-dark.png)                   | Dark         |
| [Group](./screens/20-group-dark.png)                 | Dark         |
| [Add expense](./screens/21-add-expense-dark.png)     | Dark         |
| [Split sheet](./screens/22-split-sheet-dark.png)     | Dark         |
| [Add expense](./screens/23-add-expense-360x640.png)  | 360 × 640 dp |
| [Group](./screens/24-group-360x640.png)              | 360 × 640 dp |
| [Add expense](./screens/25-add-expense-130-text.png) | 130% text    |
| [Group](./screens/26-group-130-text.png)             | 130% text    |

## Design notes

### Vocabulary

These notes follow the glossary in `CONTEXT.md`:

- A Group's shape is its **Theme** (Household, Trip, Work, Couple or General).
- **Category** belongs only to Expenses.
- A **Tag** is the Group-scoped label that every Expense needs.
- **Month** is a Household's read-only lens over Expenses, never a ledger boundary.

### Navigation

- **Home:**
  - Has no bottom navigation.
  - Account opens from the avatar.
  - Groups open from their rows.
- **Inside a Group**, a bottom navigation bar switches between three Group-scoped destinations: Expenses, Balances and Activity. There is no app-wide Activity.
- **Full-screen tasks**, with no bottom navigation:
  - The Expense form.
  - The Expense record.
  - Members and Group details, opened from ⋮.
- **Record payment** is a sheet over Balances.
- **Back:**
  - Back from the Expense form or record returns to the originating Group destination, Month and scroll position ([#104](https://github.com/FireBird1998/splitbook/issues/104)).
  - Back from a Group returns Home.
- **After saving an Expense that belongs to another Month**, show a "View in {Month}" snackbar instead of switching Month.

### Token usage

| Meaning                                   | Fill or border                         | Text and icons                      |
| ----------------------------------------- | -------------------------------------- | ----------------------------------- |
| Primary action, selection, brand          | `brand.main` / `brand.bg`              | `brand.contrastText` / `brand.main` |
| You owe                                   | `negative.main` (bars, error borders)  | `status.negative`                   |
| Owed to you, "adds up"                    | `positive.main` (bars) / `positive.bg` | `status.positive`                   |
| Ordinary draft, suggestion                | `info.bg`                              | `status.info`                       |
| Save not confirmed, conflict, overpayment | `warning.bg`                           | `status.warning`                    |
| Offline, settled up                       | `surfaceMuted`                         | `textSecondary`                     |
| Trip strip                                | `strip.gradient`                       | `strip.text` / `strip.muted`        |

Coral and mint text always uses the `status.*` foregrounds: `negative.main` and `positive.main` fall below 4.5:1 on white. Settled balances are shown in neutral text, never mint.

### Type

All sizes are in dp and scale with the Android font size. Layout boxes do not scale.

| Role                     | Font                       | Size / line height | Weight |
| ------------------------ | -------------------------- | ------------------ | ------ |
| Screen title             | Outfit                     | 20 / 1.2           | 600    |
| Heading                  | Outfit                     | 16 / 1.3           | 600    |
| Body                     | Outfit                     | 15 / 1.35          | 400    |
| Small                    | Outfit                     | 13 / 1.38          | 400    |
| Caption                  | Outfit                     | 12 / 1.3           | 400    |
| Overline                 | Outfit, uppercase, +0.08em | 11.5 / 1.3         | 600    |
| Description input        | Outfit                     | 17                 | 400    |
| Form amount, hero amount | IBM Plex Mono, tabular     | 32 / 1.1           | 500    |
| Balance amount           | IBM Plex Mono, tabular     | 19 / 1.25          | 500    |
| List amount              | IBM Plex Mono, tabular     | 15 / 1.3           | 500    |
| Table amount             | IBM Plex Mono, tabular     | 13 / 1.3           | 500    |

### Layout and components

| Component         | Specification                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen            | 16 side gutters; 10–12 between sections                                                                                                                                |
| Tap targets       | At least 48 (44 inside sheets for chips, steppers and calendar days)                                                                                                   |
| Top bar           | Min height 64; icon buttons 48; title plus a one-line subtitle                                                                                                         |
| Bottom navigation | Min height 80; three equal destinations; active pill 60 × 32, radius 16, `brand.bg`                                                                                    |
| Card              | Radius 14, 1 border `border`, `surface` fill                                                                                                                           |
| List row          | Min height 60; padding 8 × 14; leading icon tile 40 (radius 12) or avatar 32 (radius 11); trailing amount in mono with a caption below                                 |
| Selector tile     | Min height 60; radius 12; 20 icon in `brand.main`; caption label above a semibold value; error state uses a 2 `negative.main` border; locked state uses `surfaceMuted` |
| Tile grid         | Two columns with 8 gaps; one column at 130% text                                                                                                                       |
| Summary stats     | Three columns; one column with label and value side by side at 130% text                                                                                               |
| Buttons           | Min height 48, radius 12; small 44; primary, tonal (`brand.bg`) and text                                                                                               |
| Add button        | Extended floating button, min height 56, radius 16, 16 from the right and 96 from the bottom (above the navigation)                                                    |
| Save bar          | Pinned to the bottom with a top border; sits directly above the keyboard when it is open                                                                               |
| Chips, segmented  | Min height 44, radius 12; the segmented control is 44 high inside a 3 padded `surfaceMuted` track                                                                      |
| Stepper           | 44 × 44 − and + with the value between                                                                                                                                 |
| Banner            | Radius 12, padding 10 × 12, 20 icon, title plus one sentence                                                                                                           |
| Snackbar          | Min height 48, radius 12, inverse colours, 92 from the bottom; the add button moves above it                                                                           |
| Badge             | Pill; icon 16 plus a short label                                                                                                                                       |
| Linear progress   | 3 high under the top bar; one per screen                                                                                                                               |
| Trip strip        | Min height 72, radius 16; route codes in mono 22; perforation divider; dates and member count on the right                                                             |
| Icons             | Ionicons outline equivalents of the canvas icons                                                                                                                       |

### Bottom sheets

- The handle is 36 × 4.
- The header is at least 56 high, with a title (and optional subtitle) and Done.
- The body is padded 20.
- The footer is pinned, with a top border, and holds totals and status.
- Height grows with content up to 90% of the screen, then the body scrolls.
- Swiping down, tapping outside and Back all behave like Done and keep entries.
- The top corners have radius 24.

### Expense form rules

- Amount, Description and Tag carry a "Required" marker before any attempt to save. Category and Notes sit behind one "Optional" row.
- The currency chip is read-only: new Expenses use the Group currency, and edits keep the Expense's currency.
- Split methods are Equal, Amounts, Percentage and Shares. "Amounts" covers the stored `unequal` and `exact` methods.
- The "Who owes what" table is always visible for up to four participants. With more, it shows three and "Show all".
- A rounding note appears only when rounding happened.
- The Save label includes the amount once it is valid.
- Discard draft lives in ⋮, behind a confirmation.

### States

| State                 | Treatment                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| First load            | Skeleton rows plus one linear progress bar; never a full-screen loader                            |
| Refreshing            | Content stays; freshness reads "Saved hh:mm · refreshing"; automatic refresh is silent            |
| Offline, saved copy   | Offline banner, saved time on each view, and writes disabled with a stated reason                 |
| Not available offline | Compact message with Try again; the navigation bar stays                                          |
| Draft                 | Info tone; the add button reads "Resume draft"                                                    |
| Save not confirmed    | Warning tone; fields locked; "Check and finish saving" reuses the same submission                 |
| Corrections           | Linked summary at the top, messages beside each control; nothing rounded or substituted silently  |
| After Save            | Snackbar and the new row highlighted; "View in {Month}" when the Expense belongs to another Month |

Draft and "save not confirmed" must never share styling.
