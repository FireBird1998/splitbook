'use client';

import CurrencySwitch from '@/components/common/CurrencySwitch';
import MoneyText from '@/components/common/MoneyText';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { CurrencySpending } from '@splitbook/shared/spending-currencies';

/** The tab id for a currency, which the panel it shows names (`aria-labelledby`). */
export const spendingTabId = (currency: string) => `spending-tab-${currency}`;

/** "INR, main currency, ₹48,600.00 spent in 3 Expenses", as a screen reader names the tab. */
function tabName(row: CurrencySpending, main: boolean) {
  const spent = formatCurrency(toMajorAmount(row.spentMinor, row.currency), row.currency);
  return [
    row.currency,
    ...(main ? ['main currency'] : []),
    `${spent} spent in ${row.expenseCount} ${row.expenseCount === 1 ? 'Expense' : 'Expenses'}`,
  ].join(', ');
}

/**
 * Insights and the Trip summary show one currency at a time (#729, boards "Insights opens on the
 * most-spent currency" and "Trip strip and Trip summary by currency"): a tab per currency with
 * what was spent in it, beside a note such as which currency it opened on. Nothing is converted.
 */
export default function SpendingCurrencySwitch({
  currencies,
  mainCurrency,
  value,
  onChange,
  note,
  panelId,
}: {
  /** From `spendingCurrencies`: the main currency first. */
  currencies: readonly CurrencySpending[];
  mainCurrency: string;
  value: string;
  onChange: (currency: string) => void;
  note?: string;
  /** The panel the tabs show, when the page marks one (`aria-controls`). */
  panelId?: string;
}) {
  return (
    <CurrencySwitch
      tabs={currencies.map((row) => ({
        currency: row.currency,
        main: row.currency === mainCurrency,
        id: spendingTabId(row.currency),
        accessibleName: tabName(row, row.currency === mainCurrency),
        figure: (
          <MoneyText
            amount={toMajorAmount(row.spentMinor, row.currency)}
            currency={row.currency}
            tone="neutral"
            sx={{ fontSize: '0.9375rem', fontWeight: 500 }}
          />
        ),
      }))}
      value={value}
      onChange={onChange}
      label="Spending in"
      note={note}
      panelId={panelId}
    />
  );
}
