/**
 * How a Trip's days read (#316): "Fri 18 Sep", and "Day 2 · Fri 18 Sep" once the Trip has a
 * first day. A day is a calendar day in the viewer's own time zone (`zoned-calendar`), and its
 * label uses the app's date pattern for Expense dates ("Fri 18 Sep", with the year when it
 * isn't this year's), so the Insights tab and the Expenses table name a day the same way.
 */
import { format } from 'date-fns';
import { dayCount } from '@splitbook/shared/trip-summary';
import type { DayKey } from '@splitbook/shared/zoned-calendar';

/** The Expenses table's date pattern (`expenseDay`), without and with the year. */
const DAY_PATTERN = 'EEE d MMM';
const DAY_PATTERN_WITH_YEAR = 'EEE d MMM yyyy';

/**
 * A calendar day as a local date at noon, so formatting reads back the same day whatever zone
 * this runs in (noon is never skipped by a daylight-saving change).
 */
function localNoon(day: DayKey): Date {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(2000, 0, 1, 12);
  value.setFullYear(year, month - 1, date);
  return value;
}

/** "Fri 18 Sep", or "Fri 18 Sep 2025" outside `thisYear` (the viewer's current year). */
export function tripDayLabel(day: DayKey, thisYear: number): string {
  return format(
    localNoon(day),
    Number(day.slice(0, 4)) === thisYear ? DAY_PATTERN : DAY_PATTERN_WITH_YEAR,
  );
}

/** "Fri 18": a column's label under a short Trip's chart. */
export function tripDayShort(day: DayKey): string {
  return format(localNoon(day), 'EEE d');
}

/** The day's number in the Trip: 1 for its first day; null before it or without one. */
export function tripDayNumber(day: DayKey, firstDay: DayKey | null): number | null {
  if (!firstDay || day < firstDay) return null;
  return dayCount(firstDay, day);
}

/**
 * "Day 2 · Fri 18 Sep" for a day of the Trip, "Fri 18 Sep" without a first day. Outside the
 * Trip's dates, "Before the trip · Mon 14 Sep" and "After the trip · Tue 22 Sep".
 */
export function tripDayName(
  day: DayKey,
  { start, end, thisYear }: { start: DayKey | null; end: DayKey | null; thisYear: number },
): string {
  const label = tripDayLabel(day, thisYear);
  if (start && day < start) return `Before the trip · ${label}`;
  if (end && day > end) return `After the trip · ${label}`;
  const number = tripDayNumber(day, start);
  return number === null ? label : `Day ${number} · ${label}`;
}
