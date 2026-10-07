'use client';

import Box from '@mui/material/Box';
import { format } from 'date-fns';
import MoneyText from '@/components/common/MoneyText';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { RADIUS } from '@/lib/theme/tokens';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import {
  expensePayerSummary,
  expenseSplitSummary,
  listedExpensePosition,
} from '@splitbook/shared/expense-row';
import { ExpenseTag, PayerLabel, PositionText, RepeatsIcon } from './expense-row-parts';

/** The table's columns, as the design canvas ("GroupExpenses") lays them out. */
export const EXPENSE_TABLE_COLUMNS = [
  'Date',
  'Description',
  'Paid by',
  'Split',
  'Amount',
  'You',
] as const;

/** "Wed 30 Sep", with the year when it isn't this year's, in the viewer's own time zone. */
export function expenseDay(date: string, now: Date = new Date()): string {
  const day = new Date(date);
  return format(day, day.getFullYear() === now.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

interface ExpenseTableProps {
  expenses: ExpenseRead[];
  userId: string;
  /** Repeat icons show only while recurring Expenses are switched on (#289). */
  recurringExpensesEnabled: boolean;
  /** The section's name, e.g. "Expenses, September 2026". */
  label: string;
  /** Read before the table: what it lists and in which order. */
  caption: string;
  /** The Expense open in the side panel. */
  openId: string | null;
  onToggle: (expenseId: string) => void;
  /** The side panel's element, which the open row's button controls (#311). */
  panelId: string;
  /** Dim the rows while a newer page loads. */
  stale?: boolean;
}

const cell = {
  px: '10px',
  py: '6px',
  height: 56,
  borderBottom: 1,
  borderColor: 'divider',
  verticalAlign: 'middle',
  '&:first-of-type': { pl: '20px' },
  '&:last-of-type': { pr: '20px' },
} as const;

/**
 * A Group's Expenses on a computer (#310, design canvas "GroupExpenses"): the date, the
 * description with its Tag (and a repeat icon while recurring Expenses are on), who paid, how
 * it is split, the amount and the member's position. Each row's description is a button that
 * opens the Expense in the side panel beside the table (#311), and closes it again; a click
 * anywhere on the row does the same. The row itself is not a control, so no control sits
 * inside another.
 */
export default function ExpenseTable({
  expenses,
  userId,
  recurringExpensesEnabled,
  label,
  caption,
  openId,
  onToggle,
  panelId,
  stale = false,
}: ExpenseTableProps) {
  const now = new Date();
  return (
    <Box
      component="section"
      aria-label={label}
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          component="table"
          sx={{
            width: '100%',
            // Beside the side panel (#311) a 1280 px screen leaves the table about 630 px, so
            // who paid and the split may wrap there; the dates and money never do.
            minWidth: 600,
            borderCollapse: 'collapse',
            fontSize: '0.875rem',
            transition: 'opacity 0.2s',
            opacity: stale ? 0.6 : 1,
            // The card draws the last line.
            '& > tbody > tr:last-of-type > td': { borderBottom: 0 },
          }}
        >
          <Box component="caption" sx={visuallyHidden}>
            {caption}
          </Box>
          <thead>
            <tr>
              {EXPENSE_TABLE_COLUMNS.map((column) => (
                <Box
                  component="th"
                  key={column}
                  scope="col"
                  sx={{
                    ...cell,
                    height: 'auto',
                    py: '10px',
                    textAlign: column === 'Amount' || column === 'You' ? 'right' : 'left',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'text.secondary',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {column}
                </Box>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => {
              const open = expense._id === openId;
              const repeats = recurringExpensesEnabled && Boolean(expense.recurringExpense);
              return (
                <Box
                  component="tr"
                  key={expense._id}
                  data-expense-id={expense._id}
                  onClick={() => onToggle(expense._id)}
                  sx={{
                    cursor: 'pointer',
                    '& > td': { bgcolor: open ? 'tint.brand' : undefined },
                    '&:hover > td': { bgcolor: open ? 'tint.brand' : 'surface.hover' },
                  }}
                >
                  <Box
                    component="td"
                    sx={{
                      ...cell,
                      whiteSpace: 'nowrap',
                      fontSize: '0.8125rem',
                      color: 'text.secondary',
                    }}
                  >
                    {expenseDay(expense.date, now)}
                  </Box>
                  <Box component="td" sx={cell}>
                    {/* The row's click opens it; the button is how a keyboard does. */}
                    <Box
                      component="button"
                      type="button"
                      aria-expanded={open}
                      aria-controls={open ? panelId : undefined}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        gap: '3px',
                        minHeight: 44,
                        p: 0,
                        border: 0,
                        bgcolor: 'transparent',
                        textAlign: 'left',
                        color: 'text.primary',
                        font: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontWeight: 600,
                        }}
                      >
                        {expense.description}
                        {repeats && <RepeatsIcon />}
                      </Box>
                      {expense.tag && <ExpenseTag name={expense.tag} />}
                    </Box>
                  </Box>
                  <Box component="td" sx={cell}>
                    <PayerLabel payer={expensePayerSummary(expense, userId)} />
                  </Box>
                  <Box
                    component="td"
                    sx={{ ...cell, fontSize: '0.8125rem', color: 'text.secondary' }}
                  >
                    {expenseSplitSummary(expense)}
                  </Box>
                  <Box component="td" sx={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <MoneyText
                      amount={expense.amount}
                      currency={expense.currency}
                      tone="neutral"
                      variant="body2"
                    />
                  </Box>
                  <Box component="td" sx={{ ...cell, textAlign: 'right' }}>
                    <PositionText
                      position={listedExpensePosition(expense, userId)}
                      currency={expense.currency}
                    />
                  </Box>
                </Box>
              );
            })}
          </tbody>
        </Box>
      </Box>
    </Box>
  );
}
