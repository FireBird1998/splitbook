# Feature: Multi-Currency Support

## Overview

Each group has a **default currency** and up to **2 alternate currencies**. This allows quick selection when adding expenses — especially useful for travel groups where you switch between local and home currencies.

---

## User Stories

1. **As a group creator**, I can set a default currency when creating the group.
2. **As a group admin**, I can add up to 2 alternate currencies for the group.
3. **As a user**, when adding an expense, I see the group's 3 currencies first in the dropdown.
4. **As a user**, I can still select any currency for an expense (not limited to group currencies).
5. **As a user**, I can set my preferred currency in my profile.

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
  { code: "USD", name: "US Dollar", symbol: "$", flag: "🇺🇸" },
  { code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺" },
  { code: "GBP", name: "British Pound", symbol: "£", flag: "🇬🇧" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", flag: "🇮🇳" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", flag: "🇯🇵" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", flag: "🇨🇦" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", flag: "🇦🇺" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", flag: "🇨🇭" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", flag: "🇨🇳" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", flag: "🇸🇬" },
  { code: "THB", name: "Thai Baht", symbol: "฿", flag: "🇹🇭" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", flag: "🇲🇾" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", flag: "🇮🇩" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", flag: "🇵🇭" },
  { code: "KRW", name: "South Korean Won", symbol: "₩", flag: "🇰🇷" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", flag: "🇦🇪" },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", flag: "🇸🇦" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", flag: "🇧🇷" },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$", flag: "🇲🇽" },
  { code: "ZAR", name: "South African Rand", symbol: "R", flag: "🇿🇦" },
  // ... more as needed
];
```

---

## Amount Formatting

### Display Rules

```typescript
function formatCurrency(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
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

**Important**: Balances are calculated **per-currency**, NOT converted.

```
Group: Europe Trip
  Expenses in EUR: 3
  Expenses in USD: 1
  Expenses in INR: 1

Balance display:
  You are owed:
    €50.00
    $12.00
  You owe:
    ₹500.00
```

### Why No Auto-Conversion?

1. Exchange rates fluctuate — converting would change historical balances
2. Users settle in the original currency of the expense
3. Simpler and more accurate for the user
4. Avoids disputes about which exchange rate to use

### Future Enhancement (v2)

Optional "estimated total" that converts everything to user's preferred currency using a snapshot exchange rate (clearly marked as estimate).

---

## Validation

- Currency code must be valid ISO 4217 code from our supported list
- Default currency is required when creating a group
- Alternate currencies are optional (0, 1, or 2)
- Alternate currencies must be different from default and from each other
- User's preferred currency defaults to "INR" (configurable)

