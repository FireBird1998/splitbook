# Splitbook Private Beta — Visual Prototype (Phase 1)

Standalone HTML/CSS mockups for design approval before the Phase 5 MUI theme rebuild.

**Open:** [`index.html`](./index.html) in a browser. Use the Light / Dark toggles; resize for mobile.

## Screens

| File                                                   | Screen                                       |
| ------------------------------------------------------ | -------------------------------------------- |
| [`01-persona-entry.html`](./01-persona-entry.html)     | Demo persona picker (Alex / Sam / Priya)     |
| [`02-dashboard.html`](./02-dashboard.html)             | Money-first dashboard                        |
| [`03-trip-workspace.html`](./03-trip-workspace.html)   | Trip header + Expenses / Balances / Activity |
| [`04-quick-expense.html`](./04-quick-expense.html)     | Quick expense + advanced split disclosure    |
| [`05-balances-settle.html`](./05-balances-settle.html) | Who pays whom + settlement history           |

Theme query: append `?theme=light` or `?theme=dark` (also persisted in `localStorage`).

## Visual direction

**Hybrid: Travel Ledger structure + Calm Finance restraint**

- **Signature element:** itinerary / boarding-pass trip strip (`.trip-strip`) on dashboard trip cards and trip workspace headers. This is the one memorable motif; surrounding UI stays quiet.
- Data-first layout: balance tiles, next action, lists — no stat-strip spam, no decorative gradients as the main idea.
- Light and dark designed together via semantic CSS variables (never patched after).

## Token system

Defined in [`css/tokens.css`](./css/tokens.css).

### Color primitives

| Token  | Role                  | Light     | Dark      |
| ------ | --------------------- | --------- | --------- |
| Indigo | Brand / identity      | `#3d4fcf` | `#7b8cff` |
| Sky    | Informational actions | `#0b8fd9` | `#4db4ef` |
| Coral  | Attention / you owe   | `#e04f3d` | `#f07162` |
| Mint   | Settled / you're owed | `#1a9a6e` | `#3dca96` |

### Semantic surfaces & text

| Token                       | Light        | Dark         |
| --------------------------- | ------------ | ------------ |
| `--bg`                      | `#f4f5f9`    | `#0e1016`    |
| `--surface`                 | `#ffffff`    | `#181b26`    |
| `--border`                  | `#dce0ec`    | `#2c3142`    |
| `--text`                    | `#151828`    | `#f0f2f8`    |
| `--text-secondary`          | `#4a5168`    | `#b4bace`    |
| `--text-muted`              | `#6b7289`    | `#858da3`    |
| `--positive` / `--negative` | mint / coral | mint / coral |
| `--warning`                 | `#c47a0a`    | `#e0a73a`    |
| `--focus`                   | indigo       | `#9aa6ff`    |

### Typography

| Role         | Face                        | Usage                              |
| ------------ | --------------------------- | ---------------------------------- |
| UI / content | **Outfit** (geometric sans) | Body, labels, headings             |
| Money / data | **IBM Plex Mono**           | Amounts, trip codes, currency tags |

Avoid Inter / Roboto / Arial / system stacks in production theme.

### Spacing & radius

`--space-1`…`--space-7` (4–48px), `--radius-sm/md/lg` (8 / 12 / 16), navbar height `56px` (matches app shell).

### Motion

- Panel entry: `.animate-in` (~280ms)
- Balance emphasis: `.animate-balance`
- Disabled under `prefers-reduced-motion`

## Signature element — boarding-pass strip

`.trip-strip` uses indigo gradient fill, dashed perforation, route codes (e.g. BLR → GOA), stub with personal balance in mono. Compact variant for dashboard cards; full variant for trip header.

Do not multiply competing signatures (no second motif like floating badges or collage heroes).

## Accessibility (prototype baseline)

- Visible `:focus-visible` rings using `--focus` / `--focus-ring`
- Real labels on form fields; `aria-pressed` / `aria-selected` on toggles and tabs
- Touch targets ≥ 40–44px on primary actions
- Contrast aimed at WCAG AA for text on surfaces in both themes

## Mapping to MUI theme tokens (Phase 5)

Apply in `src/providers/ThemeProvider.tsx` as shared semantic palette keys — **not** hardcoded hex in components.

| CSS token                           | Suggested MUI path                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--bg`                              | `palette.background.default`                                                                                   |
| `--surface` / `--bg-elevated`       | `palette.background.paper`                                                                                     |
| `--border`                          | `palette.divider` (+ custom `palette.border` if needed)                                                        |
| `--text`                            | `palette.text.primary`                                                                                         |
| `--text-secondary` / `--text-muted` | `palette.text.secondary` / `disabled`                                                                          |
| `--brand` (indigo)                  | `palette.primary.main`                                                                                         |
| `--info` (sky)                      | `palette.info.main`                                                                                            |
| `--negative` (coral)                | `palette.error.main` (owed)                                                                                    |
| `--positive` (mint)                 | `palette.success.main` (owed to you / settled)                                                                 |
| `--warning`                         | `palette.warning.main`                                                                                         |
| `--focus`                           | `palette.primary.main` + `MuiButtonBase` focusVisible overrides                                                |
| Outfit                              | `typography.fontFamily`                                                                                        |
| IBM Plex Mono                       | custom `typography.money` or `components` style override for amount display                                    |
| Trip strip                          | Dedicated `TripStrip` component; colors from `primary` gradient + contrast text — no one-off hex in call sites |

Light and dark `createTheme` pairs should set the same semantic keys; components consume tokens only.

## Screenshots

24 captures under [`screenshots/`](./screenshots/) — each of 6 pages × light/dark × desktop (1280) / mobile (390):

- `01-persona-entry-{light|dark}-{desktop|mobile}.png`
- `02-dashboard-{light|dark}-{desktop|mobile}.png`
- `03-trip-workspace-{light|dark}-{desktop|mobile}.png`
- `04-quick-expense-{light|dark}-{desktop|mobile}.png`
- `05-balances-settle-{light|dark}-{desktop|mobile}.png`
- `index-{light|dark}-{desktop|mobile}.png`

Verified rendering for both themes; boarding-pass trip strip is the primary visual signature.

## Out of scope

- No React / ThemeProvider / app source changes in Phase 1
- Auth seeding and demo personas implementation = Phase 2
- Full visual rebuild in the app = Phase 5 (after mockup approval)
