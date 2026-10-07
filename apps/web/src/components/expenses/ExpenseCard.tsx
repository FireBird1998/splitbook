'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import MoneyText from '@/components/common/MoneyText';
import { getCategory } from '@splitbook/shared/categories';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import {
  expensePayerSummary,
  expenseSplitSummary,
  listedExpensePosition,
} from '@splitbook/shared/expense-row';
import { ExpenseTag, PositionText, RepeatsIcon } from './expense-row-parts';

interface ExpenseCardProps {
  expense: ExpenseRead;
  userId: string;
  recurringExpensesEnabled: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** The opened Expense's details, shown below the card's summary. */
  details: ReactNode;
  detailsId: string;
}

/**
 * One Expense in the phone list (#310): what it was, who paid, how it is split, its Tag, the
 * amount and the member's position, exactly. The whole summary is one button that opens the
 * details below it, and nothing interactive sits inside it.
 */
export default function ExpenseCard({
  expense,
  userId,
  recurringExpensesEnabled,
  isExpanded,
  onToggleExpand,
  details,
  detailsId,
}: ExpenseCardProps) {
  const payer = expensePayerSummary(expense, userId);
  const position = listedExpensePosition(expense, userId);
  const category = getCategory(expense.category);

  return (
    <Paper
      variant="outlined"
      data-expense-id={expense._id}
      sx={{
        transition: 'box-shadow 0.2s, border-color 0.2s',
        borderColor: isExpanded ? 'primary.main' : 'divider',
        overflow: 'hidden',
      }}
    >
      <ButtonBase
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        // The details exist only while open, so they are named only then.
        aria-controls={isExpanded ? detailsId : undefined}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          p: 1.5,
          textAlign: 'left',
          font: 'inherit',
          color: 'text.primary',
          '&:focus-visible': { outlineOffset: '-2px' },
        }}
      >
        <Box component="span" sx={{ display: 'flex', gap: 1, minWidth: 0, flex: 1 }}>
          <Box component="span" aria-hidden sx={{ fontSize: '1.25rem', lineHeight: 1.4 }}>
            {category?.icon ?? '📋'}
          </Box>
          <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
            <Box
              component="span"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                fontWeight: 600,
                fontSize: '0.875rem',
                minWidth: 0,
              }}
            >
              <Box
                component="span"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {expense.description}
              </Box>
              {recurringExpensesEnabled && expense.recurringExpense && <RepeatsIcon />}
            </Box>
            <Box
              component="span"
              sx={{ display: 'block', fontSize: '0.75rem', color: 'text.secondary', mt: 0.25 }}
            >
              {payer.label === 'You' ? 'You paid' : `${payer.label} paid`} ·{' '}
              {expenseSplitSummary(expense)}
            </Box>
            {expense.tag && (
              <Box component="span" sx={{ display: 'block', mt: 0.75 }}>
                <ExpenseTag name={expense.tag} />
              </Box>
            )}
          </Box>
        </Box>
        <Box component="span" sx={{ display: 'block', textAlign: 'right', flexShrink: 0 }}>
          <MoneyText
            amount={expense.amount}
            currency={expense.currency}
            tone="neutral"
            variant="body2"
            fontWeight={600}
            sx={{ display: 'block' }}
          />
          <Box component="span" sx={{ display: 'block', mt: 0.25 }}>
            <PositionText position={position} currency={expense.currency} />
          </Box>
        </Box>
      </ButtonBase>
      <Collapse in={isExpanded} unmountOnExit>
        <Box sx={{ px: 1.5, borderTop: 1, borderColor: 'divider' }}>{details}</Box>
      </Collapse>
    </Paper>
  );
}
