# UI & Design System

## Overview

The app uses **Material UI (MUI) v7** exclusively for all styling and components. All layout, spacing, typography, colors, and interactive elements use MUI's `sx` prop and component library. There is no Tailwind CSS or other CSS framework.

---

## Theme

Defined in `src/providers/ThemeProvider.tsx`.

### Color Palette

```
Primary:     #6C63FF (Indigo/Purple — brand color)
Secondary:   #00BFA5 (Teal — for positive amounts / settlements)
Error:       #FF5252 (Red — for amounts owed)
Warning:     #FFA726 (Orange)
Success:     #66BB6A (Green)
Background:  #F5F5F5 (Light gray)
Surface:     #FFFFFF (White cards)
Text:        #1A1A2E (Dark navy)
TextSecondary: #6B7280 (Gray)
```

### Theme Tokens (used via sx prop)

| Token                      | Usage                             |
| -------------------------- | --------------------------------- |
| `"primary.main"`           | Brand color (#6C63FF)             |
| `"text.primary"`           | Main text (#1A1A2E)               |
| `"text.secondary"`         | Secondary text (#6B7280)          |
| `"text.disabled"`          | Muted text                        |
| `"background.default"`     | Page background (#F5F5F5)         |
| `"background.paper"`       | Card/surface background (#FFFFFF) |
| `"divider"`                | Border color                      |
| `"error.main"`             | Red for negative amounts          |
| `"success.main"`           | Green for positive amounts        |
| `"grey.50"` - `"grey.900"` | Grey scale                        |

### MUI Theme Override

```typescript
const theme = createTheme({
  palette: {
    primary: { main: '#6C63FF' },
    secondary: { main: '#00BFA5' },
    error: { main: '#FF5252' },
    warning: { main: '#FFA726' },
    success: { main: '#66BB6A' },
    background: { default: '#F5F5F5', paper: '#FFFFFF' },
    text: { primary: '#1A1A2E', secondary: '#6B7280' },
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, borderRadius: 8 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderRadius: 12 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
  },
});
```

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

| Component | Description                                                   |
| --------- | ------------------------------------------------------------- |
| `Navbar`  | Fixed top bar with hamburger (mobile), logo, user avatar menu |
| `Sidebar` | Fixed sidebar (lg+) with nav links; hidden on mobile          |

### Groups (`src/components/groups/`)

| Component           | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `GroupCard`         | Card with group name, category, members, balance       |
| `GroupsListView`    | Grid of GroupCards + create button                     |
| `GroupDetailView`   | Tabs (expenses, balances, activity) + FAB              |
| `GroupSettingsView` | Admin page: info, currency, members, tags, danger zone |
| `InviteDialog`      | Email invite + copy invite link                        |

### Expenses (`src/components/expenses/`)

| Component             | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `ExpenseListView`     | Filters, summary bar, date-grouped list with pagination             |
| `ExpenseCard`         | Expandable card with inline detail (paid by, split, notes, history) |
| `ExpenseFormDialog`   | Two-tier create/edit form (simple + advanced)                       |
| `ExpenseDetailDialog` | Full detail modal (legacy, may be removed)                          |
| `DeleteExpenseDialog` | Confirmation dialog with undo snackbar                              |

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

| Component      | Description                      |
| -------------- | -------------------------------- |
| `ActivityView` | Paginated activity feed timeline |

---

## Accessibility

- All interactive elements are keyboard accessible
- MUI components provide ARIA attributes by default
- Color contrast meets WCAG AA standards
- Focus indicators on all interactive elements
- Screen reader labels on icon-only buttons
