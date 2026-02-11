# UI & Design System

## Overview

The app uses **Tailwind CSS** for utility styling and **Material UI (MUI)** for complex interactive components (dialogs, inputs, tables, snackbars, tabs). This gives us fast iteration with Tailwind + polished UI with MUI.

---

## Theme

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

### MUI Theme Override

```typescript
const theme = createTheme({
  palette: {
    primary: { main: "#6C63FF" },
    secondary: { main: "#00BFA5" },
    error: { main: "#FF5252" },
    background: { default: "#F5F5F5" },
  },
  typography: {
    fontFamily: "Inter, system-ui, sans-serif",
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 600 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
      },
    },
  },
});
```

---

## Layout

### Desktop (≥1024px)

```
┌─────────────────────────────────────────────┐
│ Navbar (sticky top)              [User Menu] │
├────────┬────────────────────────────────────┤
│        │                                    │
│ Side-  │         Main Content               │
│ bar    │                                    │
│ (240px)│                                    │
│        │                                    │
│ - Dash │                                    │
│ - Groups│                                   │
│ - Settings│                                 │
│        │                                    │
└────────┴────────────────────────────────────┘
```

### Mobile (<1024px)

```
┌─────────────────────┐
│ Navbar    [☰] [User]│
├─────────────────────┤
│                     │
│   Main Content      │
│                     │
│                     │
├─────────────────────┤
│ Bottom Tab Bar      │
│ [Home][Groups][+][⚙]│
└─────────────────────┘
```

---

## When to Use Tailwind vs MUI

| Use Case                    | Use           |
| --------------------------- | ------------- |
| Page layout, spacing        | Tailwind      |
| Flexbox / Grid              | Tailwind      |
| Colors, typography          | Tailwind      |
| Hover/focus states          | Tailwind      |
| Responsive breakpoints      | Tailwind      |
| Buttons (simple)            | Tailwind      |
| Text inputs, Select         | MUI           |
| Dialog / Modal              | MUI           |
| Tabs                        | MUI           |
| Snackbar / Toast            | MUI           |
| DataTable (if needed)       | MUI           |
| Autocomplete / Chip input   | MUI           |
| Date picker                 | MUI           |
| Tooltips                    | MUI           |
| Avatars + Avatar groups     | MUI           |

---

## Component Library

### Reusable UI Components (src/components/ui/)

| Component        | Description                                        |
| ---------------- | -------------------------------------------------- |
| `LoadingSpinner` | Centered spinner with optional message             |
| `EmptyState`     | Illustration + message + optional CTA              |
| `ConfirmDialog`  | MUI Dialog for delete/archive confirmations        |
| `CurrencySelect` | Dropdown with currency code + symbol + flag        |
| `CurrencyAmount` | Formatted amount display (e.g. "€120.00")          |
| `AvatarStack`    | Overlapping avatars for group members               |
| `PageHeader`     | Title + description + action buttons                |
| `SearchInput`    | Debounced text input with search icon               |
| `TagChip`        | Colored chip for expense tags                       |
| `QuickFilter`    | Pill buttons for time-based filters                 |

### Layout Components (src/components/layout/)

| Component   | Description                               |
| ----------- | ----------------------------------------- |
| `Sidebar`   | Navigation sidebar with group list        |
| `Navbar`    | Top bar with breadcrumbs + user menu      |
| `MobileNav` | Bottom tab navigation for mobile          |

---

## Page-Specific Components

### Groups

| Component        | Description                                    |
| ---------------- | ---------------------------------------------- |
| `GroupCard`       | Card showing group name, members, balance      |
| `GroupForm`       | Create/edit group form                         |
| `GroupMemberList` | List of members with roles                     |
| `InviteDialog`    | Dialog to invite by email or copy link         |

### Expenses

| Component             | Description                                |
| --------------------- | ------------------------------------------ |
| `ExpenseList`         | Paginated list of expense cards            |
| `ExpenseCard`         | Single expense display (amount, who paid)  |
| `ExpenseForm`         | Add/edit expense (full form)               |
| `SplitMethodSelector` | Toggle between equal/unequal/percentage etc |
| `TagSelector`         | Multi-select tag input with suggestions    |
| `ReceiptUpload`       | Image upload with preview                  |
| `PredefinedItemPicker`| Quick-select from predefined items         |

### Balances & Settlements

| Component         | Description                                  |
| ----------------- | -------------------------------------------- |
| `BalanceSummary`  | Visual summary of who owes whom              |
| `DebtCard`        | Single debt display (A owes B $X)            |
| `SimplifiedDebts` | Minimized transaction view                   |
| `SettleUpDialog`  | Dialog to record a payment                   |
| `SettlementList`  | History of settlements                       |

### Dashboard

| Component          | Description                               |
| ------------------ | ----------------------------------------- |
| `ExpenseDashboard` | Main dashboard with filters + expense list |
| `FilterBar`        | Date range, category, tag filters          |
| `QuickFilters`     | One-click time period buttons              |

### Activity

| Component      | Description                          |
| -------------- | ------------------------------------ |
| `ActivityFeed` | Paginated activity timeline          |
| `ActivityItem` | Single activity with icon + text     |

---

## Animations & Transitions

- Page transitions: Subtle fade (CSS transitions)
- List items: Stagger fade-in on load
- Dialogs: MUI default slide-up
- Snackbars: Slide from bottom
- Skeleton loaders: For all data-fetching states

---

## Responsive Breakpoints

```
sm:  640px   — Mobile landscape
md:  768px   — Tablet
lg:  1024px  — Desktop (sidebar appears)
xl:  1280px  — Large desktop
```

---

## Accessibility

- All interactive elements are keyboard accessible
- MUI components provide ARIA attributes by default
- Color contrast meets WCAG AA standards
- Focus indicators on all interactive elements
- Screen reader labels on icon-only buttons

