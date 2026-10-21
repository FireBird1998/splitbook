'use client';

import Box from '@mui/material/Box';
import CurrencySwitch from '@/components/common/CurrencySwitch';
import MoneyText from '@/components/common/MoneyText';
import { formatCurrency } from '@splitbook/shared/currency';

/** One currency the switch offers, with the member's own balance in it. */
export interface BalanceCurrencyTab {
  currency: string;
  /** The Group's main currency. */
  main: boolean;
  /** Positive: the member is owed; negative: they owe; 0: settled up. */
  balance: number;
}

/** The tab id for a currency, which the panel it shows names (`aria-labelledby`). */
export const balanceTabId = (currency: string) => `balances-tab-${currency}`;

/** The panel the tabs show, one currency at a time. */
export const BALANCES_PANEL_ID = 'balances-panel';

function position({ balance }: BalanceCurrencyTab) {
  return balance < 0 ? 'You owe' : balance > 0 ? 'You’re owed' : 'Settled up';
}

/** "INR, main currency, you owe ₹1,480.00", as a screen reader names the tab. */
function tabName(tab: BalanceCurrencyTab) {
  const amount = formatCurrency(Math.abs(tab.balance), tab.currency);
  return [
    tab.currency,
    ...(tab.main ? ['main currency'] : []),
    tab.balance < 0
      ? `you owe ${amount}`
      : tab.balance > 0
        ? `you’re owed ${amount}`
        : 'you’re settled up',
  ].join(', ');
}

/**
 * Balances shows one currency at a time (#724, board "Balances, one currency at a time"): a tab
 * per currency, each with the member's own position in it, beside the reminder that nothing is
 * converted.
 */
export default function BalanceCurrencySwitch({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly BalanceCurrencyTab[];
  value: string;
  onChange: (currency: string) => void;
}) {
  return (
    <CurrencySwitch
      tabs={tabs.map((tab) => ({
        currency: tab.currency,
        main: tab.main,
        id: balanceTabId(tab.currency),
        accessibleName: tabName(tab),
        figure: (
          <Box component="span" sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Box component="span" sx={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {position(tab)}
            </Box>
            {tab.balance !== 0 && (
              <MoneyText
                amount={Math.abs(tab.balance)}
                currency={tab.currency}
                tone={tab.balance < 0 ? 'negative' : 'positive'}
                sx={{ fontSize: '0.9375rem', fontWeight: 500 }}
              />
            )}
          </Box>
        ),
      }))}
      value={value}
      onChange={onChange}
      label="Balances in"
      panelId={BALANCES_PANEL_ID}
      note="Each currency keeps its own balances, Debts and payments. Nothing is converted."
      noteMaxWidth={300}
    />
  );
}
