'use client';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
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
        aria-label="Spending in"
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
        {currencies.map((row) => {
          const main = row.currency === mainCurrency;
          return (
            <Tab
              key={row.currency}
              value={row.currency}
              id={spendingTabId(row.currency)}
              aria-controls={panelId}
              aria-label={tabName(row, main)}
              disableRipple
              label={
                <>
                  <Box
                    component="span"
                    sx={(theme) => ({
                      ...theme.typography.money,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: row.currency === value ? 'primary.main' : 'text.secondary',
                    })}
                  >
                    {row.currency}
                    {main && (
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
                  <MoneyText
                    amount={toMajorAmount(row.spentMinor, row.currency)}
                    currency={row.currency}
                    tone="neutral"
                    sx={{ fontSize: '0.9375rem', fontWeight: 500 }}
                  />
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
          );
        })}
      </Tabs>
      {note ? (
        <Typography
          component="p"
          sx={{ m: 0, maxWidth: 320, fontSize: '0.75rem', color: 'text.secondary' }}
        >
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}
