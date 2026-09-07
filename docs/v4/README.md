# V4 — Category as Theme (Groups, Not Only Trips)

**Status:** Shipped — all three phases  
**Decisions:** theme derived from `Group.category` (no schema change in Phase 1) · `home` renamed to "Household" in copy only · balances stay **running**, months are a **view** · trip chrome is trip-only

## Why

The app is for logging shared expenses in **personal groups and trips**. Trips are one shape of group, not the product. The private-beta UI, however, is trip-shaped everywhere: the boarding-pass `TripStrip`, airport codes derived from the group name, the "Get this trip going" checklist, "Your trips" on the dashboard, and a creation form titled "New trip".

That works beautifully for a Goa weekend and reads as a bug for "Flat 302". A flatmate group runs month-on-month with rent, groceries and utilities — it has no departure city, no end date, and no "settle after the trip" moment.

V4 turns `category` into a **theme** chosen at creation, and adds the long-running **Household** shape that month-on-month expenses need.

## Changes

| #   | Feature                                              | Doc                                    | Phase | Status |
| --- | ---------------------------------------------------- | -------------------------------------- | ----- | ------ |
| 1   | Theme registry derived from `Group.category`         | this doc, §1                           | 1     | Done   |
| 2   | Category-aware chrome (trip strip vs neutral header) | this doc, §2                           | 1     | Done   |
| 3   | Theme picker at group creation                       | this doc, §4                           | 1     | Done   |
| 4   | Terminology pass ("trips" → "groups" where generic)  | this doc, §4                           | 1     | Done   |
| 5   | Household month switcher + monthly summary           | [monthly-views.md](./monthly-views.md) | 2     | Done   |
| 6   | Recurring expense templates for Household            | this doc, §4                           | 3     | Done   |

## Key Principles

- **The theme is the group's identity, picked once.** Choosing "Trip" at creation should visibly set up the trip experience; choosing "Household" should set up months. No per-feature toggles.
- **Trip chrome earns its place only on trips.** The boarding-pass strip is the signature element of this product and should stay exactly as good as it is — for trips.
- **Neutral is not plain.** Non-trip groups get a clean, confident ledger header, not a stripped-down trip header.
- **Months are a lens, never a ledger boundary.** See §3.
- **No new colour system.** Themes differ in structure, copy, and defaults — not in palette.

---

## 1. Concept: category as theme

`Group.category` already exists and is already persisted:

```ts
category: 'trip' | 'home' | 'couple' | 'work' | 'other'; // src/lib/models/Group.ts
```

A **theme** is a pure, derived descriptor keyed by that value. Nothing new is stored.

**Phase 1 requires no schema change, no migration, and no data backfill.** Every existing group already has a category (default `'other'`), so every existing group already has a theme.

### The registry

New pure module, e.g. `packages/shared/src/group-themes.ts`, unit-testable with no DB:

```ts
export interface GroupTheme {
  /** Stored `Group.category` value — unchanged. */
  id: GroupCategory;
  /** Display name. `home` → "Household". */
  label: string;
  /** One line shown in the creation-form theme picker. */
  tagline: string;
  icon: string;
  /** Which header component the group detail page and dashboard card render. */
  header: 'strip' | 'neutral';
  /** Whether the group is date-bounded or runs indefinitely. */
  dates: 'bounded' | 'openEnded';
  /** The one distinctive surface this theme adds. */
  signature: 'checklist' | 'monthCycle' | 'none';
  /** Tags seeded on creation. */
  defaultTags: readonly string[];
  /** Nouns for generated copy, so no component hardcodes "trip". */
  nouns: { singular: string; plural: string };
}

export function getGroupTheme(category: GroupCategory): GroupTheme;
```

Consumers read the theme and branch; they never switch on the raw category string. That keeps the branch count to one per surface and makes "what does Household look like?" answerable by reading one file.

### "Household", not "home"

The product name is **Household**. The stored enum value stays `'home'`.

Renaming the stored value would mean a Mongo migration, a Zod enum change, a `GroupCategory` type change, and coordinated deploys — for a label. The theme registry maps `'home' → "Household"` in one place, so the label is free. `getGroupTheme` is the only thing that needs to know the value is historical.

### What would need schema changes later

| Later feature                                    | Schema cost                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Recurring expense templates (Phase 3)            | **New collection.** Rent/utilities definitions with cadence and last-generated marker. Cannot be derived. |
| Per-month settlement attribution                 | **`Settlement.date`.** Settlements currently have only `createdAt` (see §3).                              |
| Per-group theme override (trip chrome on a club) | New `Group.theme` field distinct from `category`. Deliberately deferred — see Out of scope.               |
| Household billing-cycle start ≠ 1st of month     | New `Group.cycleStartDay`. Not needed for v4; months are calendar months.                                 |
| Renaming stored `home` → `household`             | Data migration + enum change. Not worth it; the registry handles the label.                               |

---

## 2. Theme matrix

| Theme                  | Header treatment                                                    | Date semantics                                                          | Signature UI                                               | Default tags                                             | Dashboard card                                                    |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| **Trip** (`trip`)      | `TripStrip` boarding pass, airport codes from name, unchanged       | Bounded: Start + End date, both prominent; header shows the range       | `TripStrip` full variant + "Get this trip going" checklist | General, Food, Transport, Stay, Activities               | `TripStrip` compact card with date range and personal balance     |
| **Household** (`home`) | Neutral `GroupHeader`: name, member avatars, currency, your balance | Open-ended: no end date. Start date optional, labelled "Tracking since" | Month switcher + monthly total + per-member breakdown      | General, Rent, Utilities, Groceries, Internet, Household | Neutral card with **this month's** spend and your running balance |
| **Couple** (`couple`)  | Neutral `GroupHeader`                                               | Open-ended: dates hidden                                                | None — clean ledger                                        | General, Food, Dining, Travel, Gifts, Bills              | Neutral card with your running balance                            |
| **Work** (`work`)      | Neutral `GroupHeader`                                               | Optional bounded: dates offered under advanced settings for projects    | None — clean ledger                                        | General, Travel, Meals, Supplies, Client                 | Neutral card with your running balance                            |
| **General** (`other`)  | Neutral `GroupHeader`                                               | Open-ended: dates hidden                                                | None — clean ledger                                        | General, Food, Transport, Other                          | Neutral card with your running balance                            |

### Notes on the matrix

**Why the strip is gated rather than generalised.** `deriveTripCodes` turns a group name into a departure/arrival pair — "Goa Friends Trip" becomes `GOA ···✈··· TRI`. Applied to "Flat 302 Rent" it produces `FLA ···✈··· REN`, which is noise pretending to be information. The strip is a trip artefact. `TripStrip` and `deriveTripCodes` stay untouched; a sibling `GroupHeader` component serves the neutral themes, and `GroupDetailView` / `GroupCard` pick between them from `theme.header`.

**The neutral header carries the same information, differently.** Name, member avatars, currency, and personal balance — the four things the strip's stub and meta rows already show — in a plain `Paper` with the money typography the strip uses. No perforations, no route codes.

**Default tags become theme-scoped.** Today `DEFAULT_GROUP_TAGS` is one global list whose "Stay" and "Activities" entries are trip vocabulary; a flat gets them too. `buildDefaultGroupTags` and `mergeMissingDefaultTags` gain a category parameter. Both are already pure and unit-tested, so this is a signature change plus test updates, not new machinery. `General` stays in every list so the first expense is never blocked — that is what those defaults exist for.

**The checklist stays trip-only.** "Get this trip going" is genuinely trip-shaped: invite the crew, log the first cost, settle after. A household never reaches "settle when ready", and a couple's group has two obvious members. Non-trip themes rely on the empty state that `ExpenseListView` already renders ("Add first expense"), with theme-aware copy. `buildTripChecklist` keeps its trip copy; the calling condition moves behind `theme.signature === 'checklist'`.

**Date semantics drive the form, not just the display.** Household hides "End date" entirely — offering it invites someone to bound a group that by definition doesn't end, and `validateTripDates` would then quietly stop accepting expenses' mental model. Open-ended themes hide both fields; Work offers them under advanced settings for time-boxed projects.

---

## 3. Household monthly cycles

A household group accumulates rent, utilities, and groceries indefinitely. "What did we spend, and who fronted it?" is a **per-month** question. "What do I owe you?" is a **cumulative** question. Household needs both, and must not confuse them.

### Month navigation

A `MonthCycleBar` renders directly under the neutral header on Household groups, above the tabs:

```
┌──────────────────────────────────────────────────────────┐
│  ‹    August 2026    ›            This month · All time  │
│  Total ₹48,200 · 17 expenses · you fronted ₹22,000       │
└──────────────────────────────────────────────────────────┘
```

- `‹` / `›` step one calendar month. Forward is disabled past the current month — there is nothing to show and it invites confusion with budgeting.
- "This month" returns to the current month; "All time" clears the month filter and shows the full ledger.
- The active month drives the Expenses tab: the bar owns `dateFrom` / `dateTo` and passes them to `ExpenseListView`, which hides its quick-filter chip row while a month is active. One date filter on screen at a time.
- The month is reflected in the URL (`?month=2026-08`) so a month view is linkable and survives refresh.

The month switcher deliberately does **not** reuse the existing "Custom Range" chip: that path carries a 31-day client-side cap and its own from/to inputs, and two competing date filters in one view is the kind of thing users file bugs about.

### Per-month totals and per-member breakdown

Month totals need **no new API**. `GET /api/groups/[id]/expenses` already accepts `dateFrom` / `dateTo` and already returns a summary aggregated over the whole filtered set — `totalAmount`, `count`, `userOwes`, `userGetsBack` — not just the current page.

The per-member breakdown (who fronted what this month, and each member's share) is the one genuinely missing number. It is an additive extension to the existing summary, opt-in by query flag. Contract, aggregation shape, and the inclusive-`dateTo` correction are specified in [monthly-views.md](./monthly-views.md).

Presented as a small table under the bar: member · fronted · their share · net for the month. Net for the month is labelled as such, and visually distinct from the running balance in the header — a member who paid rent in August and nothing in September has a very different August net and running balance, and the UI must never let those two numbers be mistaken for each other.

### Settle-per-month flow

There is no separate per-month settlement. The month view's "Settle up" opens the existing Balances tab and the existing `SettleUpDialog`, against the **running** simplified debts.

What the month view adds is the prompt: at the end of a month with an outstanding balance, Household groups surface "Settle August?" which links to Balances. The nudge is monthly; the money is cumulative. If the flatmates settle every month, the running balance returns to zero every month on its own, and the monthly rhythm is emergent rather than enforced.

### Decision: balances stay running

**Balances remain running, Splitwise-style. Monthly views are read-only lenses over expenses. There is no monthly close, no reset, and no carry-forward record.**

Rationale:

1. **Settlements cannot be attributed to a month.** `Settlement` has `amount`, `currency`, `note`, and `createdAt` — no `date` field. A payment for July recorded on 3 August lands in August. Monthly closing would therefore be wrong on day one for the most common real behaviour (paying a few days late), and fixing it means a schema change plus a UI for back-dating payments.
2. **Closing periods bring invariants that dwarf the feature.** Reopening rules, carry-forward balance records, what happens when someone edits or restores a June expense in September (soft delete and restore are both supported today), and what a closed month means for a member who joined mid-month. That is a ledger system; the requirement is a summary.
3. **The running model is the part of the system that is proven correct.** `debt-simplifier` has unit coverage and `balance-integrity.integration.test.ts` covers end-to-end balance correctness. Replacing the accumulation model puts the most trustworthy component at risk to add a view.
4. **It matches the mental model users bring.** Nobody expects Splitwise to zero out on the 1st. A month filter answers "what did August cost us"; the balance answers "what do I owe you". Both are already familiar.
5. **It is reversible.** Monthly summaries are derived, so if closing periods are ever genuinely wanted, nothing built here has to be undone — `Settlement.date` gets added and the summaries gain a boundary.

Consequence for the UI: monthly figures are **descriptive**. No affordance may suggest a month can be finalised — no "Close month" button, no "settled for August" state, no month-scoped balance presented as a balance. The header's running balance is the only number labelled "your balance".

---

## 4. Implementation plan

Repo conventions apply throughout: pnpm only, `{ data }` / `{ error }` responses, business logic in `src/lib/services/`, Zod validation at the route boundary, feature-scoped components under `src/components/{feature}/`, MUI `sx` with theme tokens, UTC storage.

### Phase 1 — Category-aware chrome

No schema change. No new endpoints. Pure derivation plus branching.

- [x] **Theme registry.** Create `packages/shared/src/group-themes.ts` with `GroupTheme` and `getGroupTheme`, plus `src/lib/group-themes.test.ts` covering every category, the `home → "Household"` label, and a fallback for unknown values (defensive: old documents).
- [x] **Neutral header.** Add `src/components/groups/GroupHeader.tsx` — name, member avatars, currency, personal balance, invite code — reusing `MoneyText` and the `typography.money` treatment. Leave `TripStrip` and `deriveTripCodes` untouched.
- [x] **Gate the trip chrome.** In `GroupDetailView`, render `TripStrip` when `theme.header === 'strip'` and `GroupHeader` otherwise. Move the checklist behind `theme.signature === 'checklist'`. Replace the hardcoded "Trip not found" / "Trip settings" / "Trip sections" strings with theme nouns.
- [x] **Dashboard cards adapt.** In `GroupCard` (dashboard mode), branch the header the same way. Show the date range only for bounded themes; show "Last activity" for open-ended ones. The management mode already uses a neutral layout with a category icon — align its icon and label with the registry.
- [x] **Theme picker at creation.** In `src/app/(main)/groups/new/page.tsx`, promote category from an advanced-settings dropdown to the **first** field: five selectable cards showing icon, label, tagline, and a one-line "what you get" (e.g. Household → "Month-by-month totals and a running balance"). Selecting a theme relabels the form live — title, name-field label and placeholder, date fields per §2, and the submit button.
- [x] **Theme-aware default tags.** Add a category parameter to `buildDefaultGroupTags` / `mergeMissingDefaultTags` and per-theme lists to `packages/shared/src/default-tags.ts`; pass `category` from `groupService.create`. Update `default-tags.test.ts` (it currently asserts the five trip tags exactly). Existing groups are untouched — the merge helper only ever appends.
- [x] **Terminology pass.** Generic surfaces become group-language; trip surfaces keep trip language via `theme.nouns`. At minimum: dashboard "Your trips" → "Your groups", its subtitle and empty state, "New trip" → "New group"; `selectNextAction`'s `'create-trip'` kind → `'create-group'` with group copy (update `dashboard.test.ts` and the `DashboardNextAction` type); "Review your trip invitation" → group wording; `ExpenseListView`'s "everything on this trip" empty-state copy; `GroupSettingsView` labels; the mixed-currency alert's "A trip contains…". Sweep with `rg -i '\btrip' src` and treat every hit outside `src/components/trip/`, `trip-codes`, and trip-themed copy as a candidate.
- [x] **Verify.** `pnpm test && pnpm lint && pnpm typecheck`. Manually: create one group per theme and confirm only the trip shows the strip and checklist, and that no non-trip surface says "trip".

### Phase 2 — Household monthly views

Reuses the existing expense filter API. One additive, opt-in response field. Full contract in [monthly-views.md](./monthly-views.md).

- [x] **Fix the inclusive `dateTo` boundary.** `expense.service.ts` did `$lte: new Date(filters.dateTo)`, and a date-only string parses to UTC midnight — so expenses later on the final day were silently excluded. Landed as `toInclusiveDateToBound` in `packages/shared/src/date.ts`, covered by `expense-date-filter.integration.test.ts`.
- [x] **Per-member breakdown.** Extend the existing summary in `expenseService.getGroupExpenses` with an opt-in `byMember` array (member, `paid`, `share`, `net`) behind a query flag, so the default expense-list payload does not grow. The service already loads the full filtered set to compute `userOwes` / `userGetsBack`; the breakdown reuses that pass rather than adding a second aggregation.
- [x] **Month switcher.** Add `src/components/groups/MonthCycleBar.tsx`: month stepping with `date-fns` `startOfMonth` / `endOfMonth`, forward capped at the current month, "This month" and "All time" actions, `?month=YYYY-MM` in the URL, and the month summary line.
- [x] **Wire into the Household group page.** Render the bar when `theme.signature === 'monthCycle'`. Pass the active range into `ExpenseListView` as a controlled date range and suppress its quick-filter chips while a month is active.
- [x] **Per-member table.** Render fronted / share / net for the active month, labelled as monthly figures and visually separated from the running balance. Include the end-of-month "Settle August?" prompt linking to the Balances tab.
- [x] **Household dashboard card.** Show this month's spend alongside the running balance, using the same date-ranged summary.
- [x] **Verify.** Unit tests for the date boundary and the breakdown maths; integration coverage that a month's `byMember` nets sum to zero.

### Phase 3 — Recurring expense templates (Household)

**This phase needs a new collection.** Rent, internet, and utilities repeat with the same amount, payer, and split every month, and re-entering them is the main friction in a household group. A template is a definition, not a derivation — there is nothing in `Expense` or `Group` to compute it from.

- [x] **Model.** New `RecurringExpense` collection: `group`, `description`, `amount`, `currency`, `category`, `tag`, `paidBy`, `splitMethod`, `splitBetween`, `dayOfMonth`, `startsOn`, `endsOn`, `isPaused`, `lastGeneratedFor` (`YYYY-MM`), `createdBy`. Generated expenses carry a `recurringExpense` reference and a unique `(recurringExpense, period)` index so generation is idempotent under concurrency.
- [x] **Decide the creation trigger.** Two options:

  | Trigger                                                           | Pros                                                                                                                          | Cons                                                                                                                                      |
  | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | **Lazy on read** — generate due periods when the group is fetched | No new infrastructure. Works identically in local dev, demo seeding, and prod. Failure mode is "not yet created", not "lost". | Puts writes in a GET path; needs the unique index to stay safe under concurrent readers. A dormant group's rows appear only when visited. |
  | **Scheduled job** — cron hits an authenticated route monthly      | Expenses exist on time regardless of who opens the app. Clean read paths.                                                     | New deploy-environment dependency and a secured endpoint. Silent failure if the schedule breaks. Diverges between local and prod.         |

  **Recommendation: lazy on read**, with generation in a service called from group and expense reads, guarded by `lastGeneratedFor` and the unique index. For a private beta with active members, "created when someone looks" is indistinguishable from "created on the 1st", and it keeps the system self-contained and testable. Revisit if notifications or reminders ever need rows to exist before anyone opens the app — that requirement, not this one, is what justifies a scheduler.

- [x] **Management UI.** A "Recurring" section in Household group settings: list, add, edit, pause, delete. Deleting a template never touches expenses it already generated.
- [x] **Surface generated expenses honestly.** A "Recurring" marker on the expense card, editable and deletable like any other expense (soft delete applies).
- [x] **Verify.** Unit tests for due-period calculation across month lengths and pauses; an integration test proving two concurrent generations produce exactly one expense.

---

## 5. Out of scope

- **Per-category colour tokens.** Themes differ in structure, copy, and defaults. The existing indigo / sky / mint / coral semantic palette applies to every theme; light and dark stay designed together.
- **Budgets, spend limits, and forecasting.** A month total is not a budget, and adding targets brings goal-setting UX the beta doesn't need.
- **Notifications and reminders** ("rent is due"). Requires a delivery channel; email is still deliberately absent (see the app-hardening spec).
- **Monthly closing, reset, or carry-forward records.** Rejected in §3, not deferred.
- **`Settlement.date` and back-dated settlements.** Only needed if per-month settlement attribution is ever wanted.
- **Per-group theme override** decoupled from `category` (e.g. trip chrome on a book club). Adds a field and a second source of truth for one aesthetic preference.
- **Migrating the stored `home` value to `household`.** The registry supplies the label.
- **Configurable cycle start day** (billing cycles that don't begin on the 1st). Calendar months only.
- **Custom themes or user-defined categories.** The five fixed categories are the vocabulary.
- Already deferred elsewhere and unchanged here: receipt upload, real email delivery, FX conversion, realtime sync.
