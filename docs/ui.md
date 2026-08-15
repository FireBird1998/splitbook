# UI & Design System

## Overview

The app uses **Material UI (MUI) v7** exclusively for all styling and components. All layout, spacing, typography, colors, and interactive elements use MUI's `sx` prop and component library. There is no Tailwind CSS or other CSS framework.

Light and dark modes are both first-class and are designed together — see [Theme](#theme).

---

## Theme

Two distinct things are called "theme" in this codebase. Keep them apart:

|                  | What it is                                                  | Where                     |
| ---------------- | ----------------------------------------------------------- | ------------------------- |
| **Visual theme** | MUI palette, typography, radii — light and dark             | `src/lib/theme/`          |
| **Group theme**  | A group's shape and identity, derived from `Group.category` | `src/lib/group-themes.ts` |

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

| Token                                                             | Usage                                 |
| ----------------------------------------------------------------- | ------------------------------------- |
| `"surface.muted"` / `"surface.elevated"`                          | Recessed and raised surfaces          |
| `"border.strong"`                                                 | Emphasised borders                    |
| `"tint.brand"` / `.info` / `.positive` / `.negative` / `.warning` | Low-emphasis fills behind status text |
| `"strip.bg"` / `.text` / `.muted` / `.perforation` / `.stub`      | Trip strip only                       |
| `"focus.main"` / `"focus.ring"`                                   | Focus indicator and ring              |

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

### Desktop (≥1200px — MUI lg breakpoint)

```
┌──────────────────────────────────────────────┐
│ Navbar (fixed top, 56px)           [User Menu]│
├────────┬─────────────────────────────────────┤
│        │                                     │
│ Side-  │         Main Content                │
│ bar    │         (ml: 240px)                 │
│ (240px)│                                     │
│ fixed  │                                     │
│        │                                     │
│ - Dash │                                     │
│ - Groups│                                    │
│ - Settings│                                  │
│        │                                     │
└────────┴─────────────────────────────────────┘
```

### Mobile (<1200px)

```
┌─────────────────────┐
│ [☰] Navbar    [User]│  ← fixed top
├─────────────────────┤
│                     │
│   Main Content      │
│   (full width)      │
│                     │
│                     │
│                     │
│               [FAB] │  ← floating action button
└─────────────────────┘

☰ opens a Drawer with navigation
```

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

| Component   | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `Navbar`    | Fixed top bar with hamburger (mobile), logo, user avatar menu |
| `Sidebar`   | Fixed sidebar (lg+) with nav links; hidden on mobile          |
| `BrandMark` | Wordmark / logo                                               |

### Groups (`src/components/groups/`)

| Component                  | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `GroupCard`                | Card with group name, theme, members, balance         |
| `GroupsListView`           | Grid of GroupCards + create button                    |
| `GroupDetailView`          | Tabs (expenses, balances, activity) + FAB             |
| `GroupHeader`              | Neutral header for non-trip themes                    |
| `GroupSettingsView`        | Admin page: info, currency, members, tags, recurring  |
| `MonthCycleBar`            | Household month switcher (`?month=YYYY-MM`)           |
| `MonthMemberTable`         | Per-member fronted / share / net for the active month |
| `RecurringExpensesSection` | Household recurring templates: list, add, edit, pause |
| `InviteDialog`             | Email invite + copy invite link                       |

### Trip (`src/components/trip/`)

| Component   | Description                                                       |
| ----------- | ----------------------------------------------------------------- |
| `TripStrip` | Boarding-pass header with derived airport codes — trip theme only |

Gated on `theme.header === 'strip'`. Never render it for other themes: the
airport codes are derived from the group name and become noise off a trip.

### Expenses (`src/components/expenses/`)

| Component             | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `ExpenseListView`     | Filters, summary bar, date-grouped list with pagination             |
| `ExpenseCard`         | Expandable card with inline detail (paid by, split, notes, history) |
| `ExpenseFormDialog`   | Two-tier create/edit form (simple + advanced)                       |
| `DeleteExpenseDialog` | Confirmation dialog with undo snackbar                              |

`expense-form-helpers.ts` and `expense-duplicate-check.ts` hold the pure,
unit-tested logic extracted from the dialog.

### Balances & Settlements

| Component        | Description                                |
| ---------------- | ------------------------------------------ |
| `BalancesView`   | Net balances per member + simplified debts |
| `SettleUpDialog` | Record a payment dialog                    |

### Dashboard (`src/components/dashboard/`)

| Component        | Description                                   |
| ---------------- | --------------------------------------------- |
| `DashboardView`  | Groups overview + stats + pending invitations |
| `InvitationCard` | Accept/decline invitation card                |

### Activity (`src/components/activity/`)

| Component      | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| `ActivityView` | Activity feed timeline — fetches one page of 50, no Load More |

### Auth & demo

| Component           | Description                                  |
| ------------------- | -------------------------------------------- |
| `LoginForm`         | Google sign-in button                        |
| `DemoLoginClient`   | Demo persona sign-in                         |
| `DemoPersonaPicker` | Persona cards (Alex, Sam, Priya)             |
| `DemoModeBadge`     | Navbar badge shown while demo auth is active |

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
