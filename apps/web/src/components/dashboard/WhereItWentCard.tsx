'use client';

import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  readSpendingThisMonth,
  type SpendingThisMonthRead,
} from '@splitbook/shared/user-spending-read';
import MoneyText from '@/components/common/MoneyText';
import { visuallyHidden } from '@/components/common/visually-hidden';
import SegmentedControl from '@/components/charts/SegmentedControl';
import { HomeCard, HomeCardBody, HomeCardEmpty, HomeCardError, HomeCardLoading } from './HomeCard';
import { spendingField, useHomeSpending, type CardRead } from './home-reads';
import { thisMonthName, whereItWentModel, type WhereItWentModel } from './where-it-went';

/*
 * Home's "Where it went" (#308, design canvas "Web portal"): the member's share of this Month
 * by Category across every Group, one currency at a time, as bars in the series colour with a
 * Chart/Table switch. The table is what assistive technology reads in either view; the bars
 * are hidden from it.
 */

/** The card's region is labelled by its heading, `where-it-went-heading`. */
const CARD_ID = 'where-it-went';

export default function WhereItWentCard() {
  const { read, failed, retry } = useHomeSpending();
  const thisMonth = useMemo(
    () => spendingField(read, failed, readSpendingThisMonth),
    [read, failed],
  );
  return <WhereItWentView thisMonth={thisMonth} onRetry={retry} />;
}

export type WhereItWentViewAs = 'chart' | 'table';

interface WhereItWentViewProps {
  thisMonth: CardRead<SpendingThisMonthRead>;
  onRetry: () => void;
  /** The view shown first. */
  initialView?: WhereItWentViewAs;
}

/** The card for the Month's detail, a failed read or one still loading. */
export function WhereItWentView({
  thisMonth,
  onRetry,
  initialView = 'chart',
}: WhereItWentViewProps) {
  const [chosenCurrency, setCurrency] = useState<string>();
  const [view, setView] = useState<WhereItWentViewAs>(initialView);
  const ready = thisMonth.status === 'ready' ? thisMonth.value : null;
  const model = useMemo(
    () => (ready ? whereItWentModel(ready, chosenCurrency) : null),
    [ready, chosenCurrency],
  );
  const month = ready ? thisMonthName(ready) : 'this month';

  return (
    <HomeCard
      id={CARD_ID}
      title="Where it went"
      width="narrow"
      subtitle={`Your share by Category · ${month}${model ? ` · ${model.currency}` : ''}`}
      aside={
        model ? (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {model.currencies.length > 1 ? (
              <SegmentedControl
                label="Currency"
                value={model.currency}
                options={model.currencies.map((code) => ({ value: code, label: code }))}
                onChange={setCurrency}
              />
            ) : null}
            <SegmentedControl
              label="View as"
              value={view}
              options={[
                { value: 'chart', label: 'Chart' },
                { value: 'table', label: 'Table' },
              ]}
              onChange={setView}
            />
          </Stack>
        ) : null
      }
    >
      {model ? (
        <HomeCardBody>
          {view === 'chart' ? (
            <>
              <CategoryBars model={model} />
              <CategoryTable model={model} month={month} hidden />
            </>
          ) : (
            <CategoryTable model={model} month={month} />
          )}
        </HomeCardBody>
      ) : thisMonth.status === 'ready' ? (
        <HomeCardEmpty
          title="Nothing spent yet this month"
          description="Your share of each Expense this month will show here, by Category."
        />
      ) : thisMonth.status === 'error' ? (
        <HomeCardError message="Spending by Category could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading where your money went" blocks={4} height={22} />
      )}
    </HomeCard>
  );
}

/** A bar per Category, the largest full width: web.css .hbars. Hidden from assistive technology. */
function CategoryBars({ model }: { model: WhereItWentModel }) {
  return (
    <Box
      aria-hidden="true"
      data-testid="category-bars"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
    >
      {model.rows.map((row) => (
        <Box
          key={row.category}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(84px, 120px) minmax(48px, 1fr) auto',
            alignItems: 'center',
            gap: 1.5,
            minHeight: 28,
          }}
        >
          <Typography noWrap sx={{ fontSize: '0.875rem', color: 'text.primary' }}>
            {row.label}
          </Typography>
          <Box sx={{ position: 'relative', height: 12 }}>
            <Box
              data-testid="category-bar"
              sx={{
                position: 'absolute',
                inset: '0 auto 0 0',
                width: `${row.width}%`,
                bgcolor: 'chart.series',
                borderRadius: '0 4px 4px 0',
              }}
            />
          </Box>
          <MoneyText
            amount={row.amount}
            currency={model.currency}
            tone="neutral"
            sx={{ fontSize: '0.8125rem', whiteSpace: 'nowrap', textAlign: 'right' }}
          />
        </Box>
      ))}
    </Box>
  );
}

/** The same numbers as the bars: a row per Category, how many Expenses, and the share. */
function CategoryTable({
  model,
  month,
  hidden = false,
}: {
  model: WhereItWentModel;
  month: string;
  hidden?: boolean;
}) {
  const cell = {
    py: 1.25,
    px: 1.5,
    borderBottom: 1,
    borderColor: 'divider',
    textAlign: 'left',
  } as const;
  const number = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' } as const;
  return (
    <Box sx={hidden ? visuallyHidden : { overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          '& thead th': {
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
          },
          '& tfoot > tr > *': { borderBottom: 0, fontWeight: 600 },
        }}
      >
        <Box component="caption" sx={visuallyHidden}>
          Your share by Category in {month}, in {model.currency}
        </Box>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={cell}>
              Category
            </Box>
            <Box component="th" scope="col" sx={number}>
              Expenses
            </Box>
            <Box component="th" scope="col" sx={number}>
              Your share
            </Box>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.category}>
              <Box component="th" scope="row" sx={{ ...cell, fontWeight: 400 }}>
                {row.label}
              </Box>
              <Box component="td" sx={{ ...number, color: 'text.secondary' }}>
                {row.expenseCount}
              </Box>
              <Box component="td" sx={number}>
                <MoneyText amount={row.amount} currency={model.currency} tone="neutral" />
              </Box>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <Box component="th" scope="row" sx={cell}>
              Total
            </Box>
            <Box component="td" sx={{ ...number, color: 'text.secondary' }}>
              {model.total.expenseCount}
            </Box>
            <Box component="td" sx={number}>
              <MoneyText
                amount={model.total.amount}
                currency={model.currency}
                tone="neutral"
                sx={{ fontWeight: 600 }}
              />
            </Box>
          </tr>
        </tfoot>
      </Box>
    </Box>
  );
}
