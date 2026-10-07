/**
 * A Trip's Expenses by trip day (#316): the heading over each day's rows in the Expenses table
 * ("Day 2 · Fri 18 Sep") and the day's total. Pure, so the table and the phone's cards head the
 * same days the same way.
 *
 * - A day is a calendar day in the viewer's own time zone, as the Trip summary reads it: the
 *   Trip's dates and each Expense's date are bucketed alike, so a first day's Expense is on
 *   Day 1 whatever the zone.
 * - Days are numbered from the Trip's first day. Without one they are headed by their date
 *   alone; outside the Trip's dates they read "Before the trip" and "After the trip".
 * - A day's total adds up the Expenses listed under it, so it follows the filters and the page,
 *   exactly. It is kept per currency, never converted (only a legacy Trip has a second one).
 * - Headings only make sense in date order: the caller asks for them while the list is sorted
 *   by date.
 */
import {
  readStoredAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';
import { dayKeyInZone, type Instant } from '@splitbook/shared/zoned-calendar';
import { tripDayName } from '@/components/trip-summary/trip-days';

export interface TripDayTotal {
  currency: string;
  amountMinor: number;
  /** Major units, for `MoneyText`. */
  amount: number;
}

export interface TripDayHeading {
  /** `YYYY-MM-DD` in the viewer's time zone. */
  day: string;
  /** "Day 2 · Fri 18 Sep". */
  label: string;
  /** The day's listed Expenses, per currency: the Trip's currency first. */
  totals: TripDayTotal[];
  expenseCount: number;
}

export interface TripDayOptions {
  /** The viewer's named IANA time zone. */
  timeZone: string;
  /** The Trip's dates, as the Group read gives them. */
  startDate: Instant | null;
  endDate: Instant | null;
  /** The Trip's currency, listed first. */
  currency: string;
  now?: Date;
}

type Listed = Pick<
  ExpenseRead,
  '_id' | 'date' | 'currency' | 'amount' | 'amountMinor' | 'moneyVersion'
>;

/**
 * The heading of each day, keyed by the id of the day's first Expense in the list's order. A
 * day's rows follow its heading until the next one.
 */
export function tripDayHeadings(
  expenses: readonly Listed[],
  { timeZone, startDate, endDate, currency, now = new Date() }: TripDayOptions,
): Map<string, TripDayHeading> {
  const start = startDate ? dayKeyInZone(startDate, timeZone) : null;
  const end = endDate ? dayKeyInZone(endDate, timeZone) : null;
  const dates = {
    start: start && end && end < start ? end : start,
    end: start && end && end < start ? start : end,
    thisYear: Number(dayKeyInZone(now, timeZone).slice(0, 4)),
  };

  const headings = new Map<string, TripDayHeading>();
  let current: { heading: TripDayHeading; totals: Map<string, number> } | null = null;
  const close = () => {
    if (!current) return;
    current.heading.totals = [...current.totals]
      .sort(([a], [b]) => (a === currency ? -1 : b === currency ? 1 : a < b ? -1 : a > b ? 1 : 0))
      .map(([code, amountMinor]) => ({
        currency: code,
        amountMinor,
        amount: toMajorAmount(amountMinor, code),
      }));
  };
  for (const expense of expenses) {
    const day = dayKeyInZone(expense.date, timeZone);
    if (!current || current.heading.day !== day) {
      close();
      const heading: TripDayHeading = {
        day,
        label: tripDayName(day, dates),
        totals: [],
        expenseCount: 0,
      };
      current = { heading, totals: new Map() };
      headings.set(expense._id, heading);
    }
    const minor = readStoredAmountMinor({
      amount: expense.amount,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      moneyVersion: expense.moneyVersion,
    });
    current.totals.set(
      expense.currency,
      sumMinorAmounts([current.totals.get(expense.currency) ?? 0, minor]),
    );
    current.heading.expenseCount += 1;
  }
  close();
  return headings;
}
