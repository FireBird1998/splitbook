# Feature: Currency

> **Status.** The multi-currency design below was **not** built. Each group is
> **single-currency**: every expense and settlement must match the group's
> `defaultCurrency` or the request is rejected with **422 `CURRENCY_MISMATCH`**
> (enforced in `expense.service.ts`, `settlement.service.ts` and
> `recurring-expense.service.ts`). `alternateCurrencies` is persisted and
> API-accepted but no read or write path consults it.
>
> Cross-group aggregation *is* multi-currency: the dashboard buckets balances per
> currency and never sums across them. That part is live — see
> [Currency in balances](#currency-in-balances).

## Overview

Each group has a **default currency**, fixed at creation and changeable by an
admin in group settings. Every amount recorded in that group uses it.

A user also has a `preferredCurrency` on their profile (default `INR`). It is a
display preference for currency pickers and does not affect any group's ledger.

---

## User Stories

1. **As a group creator**, I set the currency when creating the group. ✅
2. **As a group admin**, I can change the group's default currency later. ✅
3. **As a user**, every expense I add uses the group's currency — there is no
   per-expense currency choice. ✅
4. **As a user**, I can set my preferred currency in my profile. ✅
5. **As a user**, my dashboard shows what I owe and am owed **per currency**,
   never merged into one number. ✅

Not built: per-expense currency selection, alternate-currency quick-pick, and
any form of FX conversion.

---

## Currency Selection UI

### In Group Settings

```
┌──────────────────────────────────────┐
│ Currency Settings                    │
├──────────────────────────────────────┤
│ Default Currency:                    │
│ [🇪🇺 EUR - Euro                 ▾] │
│                                      │
│ Alternate Currencies (max 2):        │
│ [🇺🇸 USD - US Dollar            ▾] │
│ [🇮🇳 INR - Indian Rupee         ▾] │
│ [+ Add alternate currency]          │
└──────────────────────────────────────┘
```

### In Expense Form — Currency Dropdown

```
┌──────────────────────────────────────┐
│ Currency                             │
├──────────────────────────────────────┤
│ ★ 🇪🇺 EUR - Euro (group default)   │  ← Group default (starred)
│   🇺🇸 USD - US Dollar              │  ← Alternate 1
│   🇮🇳 INR - Indian Rupee           │  ← Alternate 2
│ ──────────────────────────────       │
│   🇬🇧 GBP - British Pound          │  ← All other currencies
│   🇯🇵 JPY - Japanese Yen           │  ← (alphabetically)
│   ...                                │
└──────────────────────────────────────┘
```

---

## Supported Currencies

We support major world currencies. Stored as ISO 4217 codes.

```typescript
const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', flag: '🇨🇭' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', flag: '🇸🇬' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', flag: '🇹🇭' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', flag: '🇲🇾' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', flag: '🇮🇩' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', flag: '🇵🇭' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', flag: '🇰🇷' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', flag: '🇸🇦' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', flag: '🇧🇷' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', flag: '🇲🇽' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦' },
  // ... more as needed
];
```

---

## Amount Formatting

### Display Rules

```typescript
function formatCurrency(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Examples:
// formatCurrency(120, "EUR") → "€120.00"
// formatCurrency(1500, "INR") → "₹1,500.00"
// formatCurrency(25.5, "USD") → "$25.50"
// formatCurrency(10000, "JPY") → "¥10,000.00"
```

### CurrencyAmount Component

```tsx
// Displays formatted amount with positive/negative coloring
<CurrencyAmount amount={50} currency="EUR" />     // → "€50.00" (green if positive context)
<CurrencyAmount amount={-30} currency="EUR" />    // → "-€30.00" (red)
```

---

## Currency in Balances

**Important**: balances are bucketed **per-currency** and never converted.

Because a group is single-currency, the multi-currency case arises **across**
groups, on the dashboard:

```
Alex belongs to:
  Europe Trip   (EUR)  → owed  €50.00
  Flat 302      (INR)  → owes  ₹500.00
  Tokyo 2027    (JPY)  → owed  ¥1,200

Dashboard display — one bucket per currency, never summed:
  You are owed:
    €50.00
    ¥1,200
  You owe:
    ₹500.00
```

`GET /api/user/balances` returns these as `buckets`, computed by
`aggregateCurrencyBalances`. Each group's contribution is calculated separately
per currency before bucketing.

### Within a group

`GET /api/groups/[id]/balances` returns a single number per member, labelled with
the group's default currency, plus a `hasMixedCurrencies` flag.

⚠️ If a group somehow *does* contain mixed currencies — only reachable through
legacy data, since the write path forbids it — that endpoint **sums the amounts
anyway** and merely raises the flag. The number would be meaningless. The
dashboard endpoint does not have this problem.

### Why No Auto-Conversion?

1. Exchange rates fluctuate — converting would change historical balances
2. Users settle in the original currency of the expense
3. Simpler and more accurate for the user
4. Avoids disputes about which exchange rate to use

### Future Enhancement (v2)

Optional "estimated total" that converts everything to user's preferred currency using a snapshot exchange rate (clearly marked as estimate).

---

## Validation

Enforced:

- Currency code must be a valid ISO 4217 code from `CURRENCY_CODES` (Zod)
- Default currency is required when creating a group (Zod)
- `alternateCurrencies`: at most 2 entries, each a valid code (Zod + schema)
- Expense, settlement and recurring-template currency must equal the group's
  `defaultCurrency` — 422 otherwise (service)
- User's preferred currency defaults to `"INR"`

Not enforced:

- Alternate currencies being distinct from the default or from each other —
  `["EUR", "EUR"]` on a EUR group is accepted
