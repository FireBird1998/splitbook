# UI & Design System

## Overview

The app uses **Material UI (MUI) v7** exclusively for all styling and components. All layout, spacing, typography, colors, and interactive elements use MUI's `sx` prop and component library. There is no Tailwind CSS or other CSS framework.

Light and dark modes are both first-class and are designed together — see [Theme](#theme).

The runtime TypeScript theme is the sole production token authority. Static
private-beta prototypes are historical references. See the
[v1 usage and verification guide](design-system/README.md) for the component lab,
adoption scope, and review requirements. V1's pilot still requires owner visual
approval before broader screen migration.

---

## Theme

Two distinct things are called "theme" in this codebase. Keep them apart:

|                  | What it is                                                  | Where                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------- |
| **Visual theme** | MUI palette, typography, radii — light and dark             | `src/lib/theme/`                      |
| **Group theme**  | A group's shape and identity, derived from `Group.category` | `packages/shared/src/group-themes.ts` |

This section covers the visual theme. For group themes see
[`v4/README.md`](v4/README.md).

### Where it lives

- **`src/lib/theme/tokens.ts`** — semantic design tokens, defined **twice**:
  `lightTokens` and `darkTokens`. Light and dark are designed together, so every
  semantic key exists in both.
- **`src/lib/theme/createAppTheme.ts`** — builds the MUI theme from a mode, and
  augments the MUI `Palette` interface with the app's extra groups.
- **`src/providers/ThemeProvider.tsx`** — wires the theme and `CssBaseline` into
  the tree. It no longer defines the palette.

### Semantic colors

Colours are named by **role**, not by hue, and the role names are what components use.

| Role            | Meaning                            | Light     | Dark      |
| --------------- | ---------------------------------- | --------- | --------- |
| `brand`         | Identity, primary actions (indigo) | `#3d4fcf` | `#7b8cff` |
| `info`          | Informational actions (sky)        | `#0b8fd9` | `#4db4ef` |
| `positive`      | Settled / owed **to** you (mint)   | `#1a9a6e` | `#3dca96` |
| `negative`      | Attention / **you** owe (coral)    | `#e04f3d` | `#f07162` |
| `warning`       | Caution                            | `#c47a0a` | `#e0a73a` |
| `bg`            | Page background                    | `#f4f5f9` | `#0e1016` |
| `surface`       | Cards and panels                   | `#ffffff` | `#181b26` |
| `text`          | Primary text                       | `#151828` | `#f0f2f8` |
| `textSecondary` | Secondary text                     | `#4a5168` | `#b4bace` |

Plus a `strip` group — the boarding-pass gradient, perforation and stub colours
used only by `TripStrip`.

### Theme tokens (used via the sx prop)

Standard MUI keys work as usual (`primary.main`, `text.primary`,
`background.default`, `background.paper`, `divider`, `error.main`,
`success.main`). The augmented app-specific keys are:

| Token                                                             | Usage                                        |
| ----------------------------------------------------------------- | -------------------------------------------- |
| `"surface.muted"` / `"surface.elevated"`                          | Recessed and raised surfaces                 |
| `"border.strong"`                                                 | Emphasised borders                           |
| `"tint.brand"` / `.info` / `.positive` / `.negative` / `.warning` | Low-emphasis fills behind status text        |
| `"strip.bg"` / `.text` / `.muted` / `.perforation` / `.stub`      | Trip strip only                              |
| `"focus.main"` / `"focus.ring"`                                   | Focus indicator and ring                     |
| `"status.positive"` / `.negative` / `.warning` / `.info`          | Readable text on tints and ordinary surfaces |

### Typography

Two fonts, both loaded via `next/font/google` in `src/app/layout.tsx`:

- **Outfit** (`--font-outfit`) — all UI text
- **IBM Plex Mono** (`--font-plex-mono`) — money

Money is deliberately monospaced so columns of amounts align and digits do not
shift width as values change. Render it through `MoneyText` rather than styling
`Typography` ad hoc.

### Shape

`RADIUS = { sm: 8, md: 12, lg: 16 }` — buttons and chips `sm`, cards `md`,
dialogs `lg`. Buttons are `textTransform: 'none'`.

### Adding a colour

Add the key to `SemanticTokens`, then give it a value in **both** `lightTokens`
and `darkTokens` — the type makes omitting one a compile error. If components
need it through `sx`, extend the MUI palette augmentation in `createAppTheme.ts`
too. Never hardcode a hex in a component.

Use the status foregrounds for money and status labels, rather than assuming an
accent's `main` value works for small text. Light-mode readable foregrounds are
mint `#0d7654`, coral `#b93628`, warning `#875407`, and sky `#086ba8`; decorative
accent values above remain available. Form-error labels/helpers and contained
informational buttons also use readable theme defaults.

---

## Styling Approach

All styling uses MUI's `sx` prop. Key patterns:

| Need                        | Use                                                                               |
| --------------------------- | --------------------------------------------------------------------------------- |
| Generic container           | `Box` with `sx`                                                                   |
| Vertical stack with spacing | `Stack spacing={N}`                                                               |
| Horizontal row with spacing | `Stack direction="row" spacing={N}`                                               |
| Page max-width wrapper      | `Container maxWidth="sm"\|"md"\|"lg"`                                             |
| Card / panel with border    | `Paper variant="outlined"`                                                        |
| All text elements           | `Typography` with `variant` prop                                                  |
| Responsive grid             | `Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}` |
| Loading placeholder         | `Skeleton` component                                                              |
| Responsive values           | `sx={{ p: { xs: 2, sm: 3, lg: 4 } }}`                                             |

---

## Layout

The frame comes from the design canvas ("Web portal", #303) and lives in
`src/components/layout/AppShell.tsx`. Its sizes are tokens in
`packages/shared/src/design-tokens.ts`: `SIDEBAR_WIDTH` 248, `TOPBAR_HEIGHT` 68
and `CONTENT_MAX_WIDTH` 1320.

### Desktop (≥1200px — MUI lg breakpoint)

```
┌────────────┬─────────────────────────────────────────┐
│ [logo]     │ Top bar (search)  Demo ☾ [+ Add expense]│
│ Home       ├─────────────────────────────────────────┤
│            │                                         │
│ GROUPS  [+]│        Main content                     │
│ ⌂ Maple    │        (up to 1320 px, centred)         │
│   you owe… │                                         │
│ ✈ Goa      │                                         │
│   owed …+1 │                                         │
│ …          │                                         │
│────────────│                                         │
│ Settings   │                                         │
│ (AR) Alex  │                                         │
└────────────┴─────────────────────────────────────────┘
  248 px, full height, sticky
```

- The sidebar holds the 32 px logo (linking Home), the main navigation (Home;
  Export arrives with #317), the "Groups" header (a link to the `/groups` list)
  with New Group, every Group with its Theme's line icon and the member's
  balance line, and Settings and the account menu at the foot.
- A balance line reads "you owe ₹1,480.00" (negative status colour), "owed
  ₹620.00" (positive) or "Settled up" (secondary). A legacy Group with balances
  in several currencies shows its own currency first and "· +N".
- The current page has `aria-current="page"`; the Group a page belongs to is
  highlighted too.
- The top bar ends with the primary **Add expense** button (#304), on every
  signed-in page. Inside a Group (its page or its settings) it opens that
  Group's Expense form; anywhere else it first opens "Choose a Group", which
  lists the member's active Groups (never an archived one), or tells a member
  with none to create a Group first. The form is the Group page's own
  `ExpenseFormDialog`, so saving is unchanged. After a save the member stays
  on the page and a snackbar says "Expense added to {Group}".

### Mobile (<1200px)

```
┌──────────────────────────┐
│ ☰ logo   ⌕  Demo  ☾  [+] │  ← sticky top bar
├──────────────────────────┤
│                          │
│   Main content           │
│   (full width)           │
│                          │
└──────────────────────────┘

☰ opens the sidebar as a drawer: the same items, Group list included, with
44 px targets. It traps focus, closes on Escape and closes when you navigate.
Below 900 px, search is a 44 px icon button ⌕, named like the field.
Below 600 px, Add expense is a 44 px icon button [+], still named "Add expense".
```

The bar stays on one line from 320 px up, in demo mode or not
(`src/components/layout/phone-top-bar.ts`):

- Below 430 px the theme switch ☾ leaves the bar for the drawer's foot, between
  Settings and the account, with the same name ("Switch to dark mode").
- Below 375 px the bar's gaps tighten to 4 px.
- Below 360 px the logo gives way to the 32 px brand mark, still the link
  "Splitbook home".

---

## Responsive Breakpoints (MUI)

```
xs:    0px    — Mobile
sm:  600px    — Mobile landscape / small tablet
md:  900px    — Tablet
lg: 1200px    — Desktop (sidebar appears, hamburger hides)
xl: 1536px    — Large desktop
```

---

## Components

### Layout (`src/components/layout/`)

| Component       | Description                                                          |
| --------------- | -------------------------------------------------------------------- |
| `AppShell`      | Sidebar (lg+) or drawer, the top bar and `main`                      |
| `Sidebar`       | Logo, main navigation, Group list, Settings and the account          |
| `SidebarGroups` | The live Group list: Theme icon, name and balance line per Group     |
| `TopBar`        | Phones' menu button and logo, search, demo badge, theme, Add expense |
| `AccountMenu`   | Avatar and name at the sidebar's foot; Settings and Sign out         |
| `BrandLogo`     | The logo artwork, light or dark                                      |
| `BrandMark`     | The mark beside a name                                               |

### Search (`src/components/search/`)

| Component        | Description                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| `SearchLauncher` | The top bar's search field (an icon button below 900 px) and ⌘K / Ctrl+K  |
| `SearchDialog`   | The search dialog: query, debounced read, arrow keys, Enter and Escape    |
| `SearchPanel`    | Its content: empty, loading, error, no-results and grouped results states |

The shortcut is never taken while the member is typing in another field. A Group
result opens `/groups/[id]`, and a person opens the first Group shared with them. An
Expense opens `/groups/[id]/expenses?search=…`, which fills the Expense list's search.

### Groups (`src/components/groups/`)

| Component                  | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `GroupCard`                | Card with group name, theme, members, balance         |
| `GroupsListView`           | Grid of GroupCards + create button                    |
| `GroupDetailView`          | The Group page's layout: header, tabs, dialogs        |
| `GroupPageHeader`          | Theme icon, name, members, currency, Invite, settings |
| `GroupTabs`                | Tabs as links, each with its own address              |
| `GroupMembersView`         | Read-only roster: names and roles, Invite             |
| `GroupHeader`              | Neutral header for non-trip Group cards               |
| `GroupSettingsView`        | Admin page: info, currency, members, tags, recurring  |
| `MonthCycleBar`            | Household Month bar (`?month=YYYY-MM`) and figures    |
| `MonthMemberTable`         | Per-member paid / share / net for the active month    |
| `RecurringExpensesSection` | Household recurring templates: list, add, edit, pause |
| `InviteDialog`             | Email invite + copy invite link                       |

**The Group page (#305).** Each tab is its own route under the Group:
`/groups/[id]/expenses`, `/balances`, `/activity` and `/members`, so reloading,
Back and a shared link land on the tab. Insights joins them with #314; until
then it is hidden, and `GROUP_TABS` in `group-tabs.ts` is where it goes.

- `/groups/[id]` redirects to Expenses. The old `?tab=balances` link redirects
  to Balances, and `?action=add-expense` (with `?month=`) goes along to the tab,
  opens the Expense form once and then leaves the address.
- The tabs' shared layout, `(tabs)/layout.tsx`, renders `GroupDetailView`: the
  Group read, the header, a Trip's strip and setup checklist, the tabs and the
  dialogs. A refused or lost Group gets the same refusal on every tab.
- The header has no Add expense and phones have no bar at the foot: the top
  bar's Add expense (#304) opens this Group's form on every tab and on its
  settings.
- A Household's Month bar sits on the Expenses tab: a Month filters Expenses,
  and Balances always include every Month.
- Members is read-only: names and roles, never an email. Role changes and
  leaving stay in Group settings.

### Trip (`src/components/trip/`)

| Component   | Description                                                       |
| ----------- | ----------------------------------------------------------------- |
| `TripStrip` | Boarding-pass header with derived airport codes — trip theme only |

Gated on `theme.header === 'strip'`. Never render it for other themes: the
airport codes are derived from the group name and become noise off a trip.

### Expenses (`src/components/expenses/`)

| Component             | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `ExpenseListView`     | The list: toolbar, summary, table or cards, states, pagination      |
| `ExpenseToolbar`      | Search, Paid by, Tag, Amount, Involves me, date window and sort     |
| `ExpenseTable`        | Computers: date, description and Tag, Paid by, split, amount, You   |
| `ExpenseCard`         | Phones: one button per Expense that opens its details below it      |
| `ExpenseDetails`      | An opened Expense: who paid, who owes, notes, history, Edit, Delete |
| `ExpenseStats`        | The `dl` of figures the Month bar and the summary share             |
| `ExpenseFormDialog`   | Two-tier create/edit form (simple + advanced)                       |
| `DeleteExpenseDialog` | Confirmation dialog with undo snackbar                              |
| `AddExpenseLauncher`  | Top bar Add expense: the current Group's form, or choose one first  |
| `GroupChooserDialog`  | "Choose a Group": the member's active Groups, or create one first   |

`expense-form-helpers.ts` and `expense-duplicate-check.ts` hold the pure,
unit-tested logic extracted from the dialog; `add-expense.ts` holds the top bar
Add expense's (where it adds from a page, which Groups it offers, its wording).

**The Expenses tab (#310).** The view lives in the address, so reloading or
sharing the link keeps it: `search`, `paidBy` (a member id), `tag` (a Tag id),
`involvesMe=1`, `min` and `max` (amounts), `sort` (`oldest`, `largest`,
`smallest`; newest is the default), `page`, and outside a Household the date
window `when` (with `from` and `to` for a custom one). `expense-list-query.ts`
reads and writes it and drops whatever doesn't fit the Group. A top-bar search
link, `/groups/[id]?search=…`, fills the search.

- From MUI's `md` breakpoint the Expenses are a table; below it, cards. Either
  way each Expense has one button that opens its details below it (until the
  side panel, #311), and no control sits inside another.
- Positions ("you lent ₹833.00", "you owe ₹953.33") come from the shared
  `expense-row` module over the stored minor units, in the status colours,
  which reach 4.5:1 on every surface a row has, light and dark.
- Repeat icons show only while recurring Expenses are switched on (#289); the
  page reads the switch on the server.
- A Household's Month bar shows the whole Month's Spent, Your share, You paid
  and Expenses, whatever the toolbar filters; other Groups show a summary of
  the list as filtered, with "You owe" and "You get back".
- A failed load says "Expenses could not be loaded." with Try again; a failed
  refresh keeps the list and says so.

### Balances & Settlements

| Component        | Description                                |
| ---------------- | ------------------------------------------ |
| `BalancesView`   | Net balances per member + simplified debts |
| `SettleUpDialog` | Record a payment dialog                    |

### Home (`src/components/dashboard/`)

Home (the `/dashboard` route) follows the design canvas ("Web portal", Home):
rows of a wide card beside a narrow one, inside the shell's 1320 px column,
wrapping to one column on a phone. Each card is its own component with its own
reads (SWR shares them with the sidebar), so it loads, fails with Try again, and
is empty on its own. A new card joins `DashboardView` on one line, in a
`HomeRow`; the rows hold comments where #307 and #308 add theirs. A card that
brings its own frame, such as Latest changes (#309), sits in a `HomeSlot` of its
width.

| Component           | Description                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DashboardView`     | Home's layout: the heading, then the rows of cards in the canvas's order                                                                                                                                                |
| `HomeHeader`        | "Home", how many Groups, "Updated" (when the balances read last answered) and Refresh, which reads every read on screen again                                                                                           |
| `HomeCard`          | The cards' frame: `HomeRow`, `HomeCard` (wide or narrow), `HomeSlot`, `HomeList` rows, and the loading, error and empty states                                                                                          |
| `BalancesCard`      | Your balances: per currency, Net (large, signed), You owe and Owed to you, exact and never converted, and "N Groups": the Groups where the member's balance in that currency isn't zero (a settled Group isn't counted) |
| `NeedsYouCard`      | Needs you: every suggested payment the member makes or receives, with the other person, the Group, the amount and Record (the Group's Balances), then invitations; "Nothing needs you" when there is neither            |
| `InvitationRow`     | An invitation in Needs you, answered with Join or Decline                                                                                                                                                               |
| `GroupCardGrid`     | The Group cards, kept until #308 replaces them with the Groups table                                                                                                                                                    |
| `LatestChangesCard` | Latest changes (#309): the newest Activity across the member's Groups                                                                                                                                                   |

### Activity (`src/components/activity/`)

| Component      | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| `ActivityView` | Activity feed timeline — fetches one page of 50, no Load More |

### Auth & demo

| Component           | Description                                   |
| ------------------- | --------------------------------------------- |
| `LoginForm`         | Google sign-in button                         |
| `DemoLoginClient`   | Demo persona sign-in                          |
| `DemoPersonaPicker` | Persona cards (Alex, Sam, Priya)              |
| `DemoModeBadge`     | Top bar badge shown while demo auth is active |

### Common

| Component   | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| `MoneyText` | Money in IBM Plex Mono, coloured by sign via semantic tokens |

---

## Accessibility

- All interactive elements are keyboard accessible
- MUI components provide ARIA attributes by default
- Focus indicators on all interactive elements, via the `focus.main` / `focus.ring` tokens
- Screen reader labels on icon-only buttons

Enforced by `playwright/theme-a11y.spec.ts`, which runs **axe-core** across four
projects — desktop (1280×800) and mobile (390×844) × light and dark. The
assertion is on **critical** violations only, so it is a floor rather than a full
WCAG AA guarantee.
