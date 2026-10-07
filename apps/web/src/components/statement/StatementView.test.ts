import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { buildStatement } from '@splitbook/shared/statement';
import type { BackupExpenseInput, BackupGroupInput } from '@splitbook/shared/export-backup';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import StatementView from './StatementView';

/*
 * A whole-trip statement (#319, opened from Share wrap-up), rendered as the server renders it:
 * Expenses dated outside the Trip's dates count in Spent and are named as the Trip summary
 * names them (#316), "Before the trip" and "After the trip". Fictional people and figures.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';

function expense(id: string, day: string, description: string, minor: number) {
  return {
    id,
    date: `${day}T00:00:00.000Z`,
    description,
    category: 'transport',
    tag: 'Transport',
    currency: 'INR',
    amountMinor: minor,
    splitMethod: 'equal',
    paidBy: [{ userId: ALEX, amountMinor: minor }],
    splitBetween: [
      { userId: ALEX, amountMinor: minor / 2 },
      { userId: SAM, amountMinor: minor / 2 },
    ],
  } satisfies BackupExpenseInput;
}

const TRIP: BackupGroupInput = {
  id: 'c00000000000000000000001',
  name: 'Ferry to the islands',
  theme: 'trip',
  currency: 'INR',
  startDate: '2026-09-17T00:00:00.000Z',
  endDate: '2026-09-20T00:00:00.000Z',
  members: [
    { id: ALEX, name: 'Alex Rivera' },
    { id: SAM, name: 'Sam Chen' },
  ],
  names: { [ALEX]: 'Alex Rivera', [SAM]: 'Sam Chen' },
  tags: [],
  expenses: [
    expense('e1', '2026-08-30', 'Ferry tickets, booked early', 60000),
    expense('e2', '2026-09-18', 'Island guesthouse', 120000),
    expense('e3', '2026-09-22', 'Late taxi refund share', 4000),
  ],
  settlements: [],
};

function render(wholeTrip: boolean) {
  const statement = buildStatement(TRIP, {
    timeZone: 'Asia/Kolkata',
    wholeTrip,
    ...(wholeTrip ? { from: '2026-09-17', to: '2026-09-20' } : {}),
  });
  return text(
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(StatementView, { statement }),
      ),
    ),
  );
}

describe('a whole-trip statement', () => {
  it('counts Expenses outside the Trip’s dates in Spent, named as the Trip summary names them', () => {
    const page = render(true);
    expect(page).toContain('Ferry to the islands · Statement');
    expect(page).toContain('2026-09-17 – 2026-09-20 · INR · Asia/Kolkata');
    expect(page).toContain('Whole trip, including Expenses before and after the Trip’s dates.');
    expect(page).toContain('Spent: ₹1,840.00');
    expect(page).toContain('Before the trip: ₹600.00 · 1 Expense, counted in Spent');
    expect(page).toContain('After the trip: ₹40.00 · 1 Expense, counted in Spent');
    expect(page).toContain('2026-08-30 Before the trip Ferry tickets, booked early');
    expect(page).toContain('2026-09-18 Island guesthouse');
    expect(page).toContain('2026-09-22 After the trip Late taxi refund share');
    expect(page).not.toMatch(/\bYou\b/);
  });

  it('names nothing outside the Trip’s dates in a statement for a period', () => {
    const page = render(false);
    expect(page).toContain('All time');
    expect(page).not.toMatch(/Before the trip|After the trip|Whole trip/);
    expect(page).toContain('Spent: ₹1,840.00');
  });
});
