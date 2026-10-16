import type { DayKey, Instant, MonthKey } from './zoned-calendar';

/**
 * An Expense's date is a calendar day, such as 16 Oct, with no time of day (#437). It is stored
 * at midnight UTC, so it is read in UTC: every viewer sees the day the member picked, whatever
 * their zone.
 */

/** The day (`YYYY-MM-DD`) an Expense is dated. Older dates stored at another time keep their UTC day. */
export function expenseDay(date: Instant): DayKey {
  return new Date(date).toISOString().slice(0, 10);
}

/** The calendar Month (`YYYY-MM`) an Expense is dated in. */
export function expenseMonth(date: Instant): MonthKey {
  return expenseDay(date).slice(0, 7);
}

/**
 * A Month's Expenses read: those dated from its first to its last calendar day. The list reads
 * `dateFrom` from that day's start and `dateTo` to its end, in UTC as Expenses are stored, so a
 * Month holds the same Expenses for every viewer.
 */
export function expenseMonthRange(month: MonthKey): { dateFrom: DayKey; dateTo: DayKey } {
  const match = /^([1-9]\d{3})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error('Choose a valid Month.');
  const lastDay = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** The stored form of a day (`YYYY-MM-DD`): midnight UTC. */
export function expenseDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The stored form of the day an instant falls on in UTC. */
export function onExpenseDay(date: Date): Date {
  return expenseDate(expenseDay(date));
}

/**
 * The Expense's day as a local midnight, for formatters that read the viewer's zone (date-fns,
 * `toLocaleDateString` without `timeZone`): they then show the stored day, never a shifted one.
 */
export function expenseLocalDate(date: Instant): Date {
  const [year, month, day] = expenseDay(date).split('-').map(Number);
  return new Date(year, month - 1, day);
}
