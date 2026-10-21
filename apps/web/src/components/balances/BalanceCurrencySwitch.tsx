'use client';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
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
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
      }}
    >
      <Tabs
        value={value}
        onChange={(_event, currency: string) => onChange(currency)}
        aria-label="Balances in"
        sx={{
          // Cards on the page, not the theme's segmented track.
          minHeight: 0,
          p: 0,
          borderRadius: 0,
          bgcolor: 'transparent',
          '& .MuiTabs-indicator': { display: 'none' },
          '& .MuiTabs-flexContainer': { flexWrap: 'wrap', gap: 1 },
        }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.currency}
            value={tab.currency}
            id={balanceTabId(tab.currency)}
            aria-controls={BALANCES_PANEL_ID}
            aria-label={tabName(tab)}
            disableRipple
            label={
              <>
                <Box
                  component="span"
                  sx={(theme) => ({
                    ...theme.typography.money,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: tab.currency === value ? 'primary.main' : 'text.secondary',
                  })}
                >
                  {tab.currency}
                  {tab.main && (
                    <Box
                      component="span"
                      sx={{
                        fontFamily: (theme) => theme.typography.fontFamily,
                        fontWeight: 500,
                        ml: 0.75,
                      }}
                    >
                      · main
                    </Box>
                  )}
                </Box>
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
              </>
            }
            sx={{
              minWidth: 150,
              minHeight: 0,
              px: 2,
              py: 1.25,
              gap: '1px',
              alignItems: 'flex-start',
              textAlign: 'left',
              textTransform: 'none',
              color: 'text.primary',
              opacity: 1,
              border: 1,
              borderColor: 'border.strong',
              borderRadius: '12px',
              bgcolor: 'background.paper',
              '&.Mui-selected': {
                color: 'text.primary',
                borderColor: 'primary.main',
                bgcolor: 'tint.brand',
                boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}`,
              },
            }}
          />
        ))}
      </Tabs>
      <Typography
        component="p"
        sx={{ m: 0, maxWidth: 300, fontSize: '0.75rem', color: 'text.secondary' }}
      >
        Each currency keeps its own balances, Debts and payments. Nothing is converted.
      </Typography>
    </Box>
  );
}
