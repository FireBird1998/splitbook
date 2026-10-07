'use client';

import { Fragment } from 'react';
import Box from '@mui/material/Box';
import MoneyText from '@/components/common/MoneyText';
import { visuallyHidden } from '@/components/common/visually-hidden';
import type { TripDayHeading } from './expense-trip-days';

const cell = {
  px: '10px',
  pt: '14px',
  pb: '4px',
  height: 34,
  borderBottom: 1,
  borderColor: 'divider',
  verticalAlign: 'bottom',
  bgcolor: 'transparent',
} as const;

/**
 * A trip day's heading row in a Trip's Expenses table (#316, design canvas "Trip Group",
 * `.daygap`): "Day 2 · Fri 18 Sep" across the first columns and the day's total under Amount.
 * The day names the row, so a screen reader reads the total as that day's.
 */
export default function TripDayRow({
  heading,
  columns,
}: {
  heading: TripDayHeading;
  /** How many columns the table has: the label spans all but Amount and You. */
  columns: number;
}) {
  return (
    <Box component="tr" data-trip-day={heading.day}>
      <Box
        component="th"
        scope="row"
        colSpan={columns - 2}
        sx={{
          ...cell,
          pl: '20px',
          textAlign: 'left',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'text.secondary',
          whiteSpace: 'nowrap',
        }}
      >
        {heading.label}
      </Box>
      <Box component="td" sx={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <TripDayTotals totals={heading.totals} />
      </Box>
      <Box component="td" sx={{ ...cell, pr: '20px' }} />
    </Box>
  );
}

/** A trip day's total, read as "Day total ₹3,180.00", each currency on its own. */
export function TripDayTotals({ totals }: { totals: TripDayHeading['totals'] }) {
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      <Box component="span" sx={visuallyHidden}>
        Day total{' '}
      </Box>
      {totals.map((total, index) => (
        <Fragment key={total.currency}>
          {index > 0 ? (
            <Box component="span" aria-hidden="true" sx={{ px: 0.75, color: 'text.secondary' }}>
              ·
            </Box>
          ) : null}
          <MoneyText
            amount={total.amount}
            currency={total.currency}
            tone="neutral"
            variant="body2"
            sx={{ fontWeight: 600, fontSize: '0.8125rem' }}
          />
        </Fragment>
      ))}
    </Box>
  );
}
