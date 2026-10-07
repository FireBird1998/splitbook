/**
 * Pure due-period calculation for recurring expense templates (v4 Phase 3).
 *
 * A period is a calendar month keyed `YYYY-MM` (UTC, zero-padded, so string
 * comparison is chronological). A template's expense for a period is dated on
 * its `dayOfMonth`, clamped to the month's last day (day 31 → Feb 28/29).
 * A period is due when its clamped expense date falls within
 * [startsOn, endsOn] (inclusive, day granularity) and the period is after
 * `lastGeneratedFor` and not after the current month. Paused templates are
 * never due. No DB access — this module is the primary test seam.
 */

export interface RecurringSchedule {
  /** 1–31; clamps to the last day of short months. */
  dayOfMonth: number;
  /** First expense is the first clamped occurrence on/after this date. */
  startsOn: Date | string;
  /** Optional inclusive end boundary; no periods are due after it. */
  endsOn?: Date | string | null;
  isPaused: boolean;
  /** Last materialized period (`YYYY-MM`); periods after it are candidates. */
  lastGeneratedFor?: string | null;
}

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Format a date as its UTC period (`YYYY-MM`). */
export function toPeriod(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function shiftPeriod(period: string, delta: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return toPeriod(new Date(Date.UTC(year, month - 1 + delta, 1)));
}

export function nextPeriod(period: string): string {
  return shiftPeriod(period, 1);
}

export function previousPeriod(period: string): string {
  return shiftPeriod(period, -1);
}

/**
 * The expense date for a period: the configured day clamped to the month's
 * length, at UTC midnight. Throws on malformed periods (programmer error).
 */
export function expenseDateForPeriod(period: string, dayOfMonth: number): Date {
  if (!PERIOD_PATTERN.test(period)) {
    throw new Error(`Invalid period: "${period}" — expected YYYY-MM`);
  }
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Math.trunc(dayOfMonth)), daysInMonth);
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

/**
 * List the periods due for materialization, oldest first. Pure: the same
 * schedule and current period always yield the same list.
 */
export function getDuePeriods(schedule: RecurringSchedule, currentPeriod: string): string[] {
  if (schedule.isPaused) return [];
  if (!PERIOD_PATTERN.test(currentPeriod)) return [];

  const startsOn = startOfUtcDay(new Date(schedule.startsOn));
  if (Number.isNaN(startsOn.getTime())) return [];

  const endsOn = schedule.endsOn ? endOfUtcDay(new Date(schedule.endsOn)) : null;
  if (endsOn && Number.isNaN(endsOn.getTime())) return [];
  if (endsOn && endsOn < startsOn) return [];

  // Defensive: a malformed stored marker is treated as absent.
  const lastGenerated =
    schedule.lastGeneratedFor && PERIOD_PATTERN.test(schedule.lastGeneratedFor)
      ? schedule.lastGeneratedFor
      : null;

  // Earliest candidate: the month containing startsOn, or the month after the
  // last materialized period — whichever is later.
  let cursor = toPeriod(startsOn);
  if (lastGenerated && nextPeriod(lastGenerated) > cursor) {
    cursor = nextPeriod(lastGenerated);
  }

  const due: string[] = [];
  while (cursor <= currentPeriod) {
    const date = expenseDateForPeriod(cursor, schedule.dayOfMonth);
    if (date >= startsOn && (!endsOn || date <= endsOn)) {
      due.push(cursor);
    }
    cursor = nextPeriod(cursor);
  }
  return due;
}

const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A date's UTC calendar day, `YYYY-MM-DD`: how a recurring Expense's date reads. */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The day (`YYYY-MM-DD`) of the next Expense a template will add (#315): its first day on or
 * after `today` in a month it hasn't added yet (after `lastGeneratedFor`), or null when it never
 * will again, paused or past its end. A read adds a month's Expense on the month's first read,
 * so an Expense dated later this month can already be in the ledger; the next is then next
 * month's. Days are the template's own calendar days (its Expenses are dated at UTC midnight on
 * them), so "the 5th" is the 5th in every zone; the caller passes `today` as the viewer's own
 * calendar day. Pure, like `getDuePeriods`.
 */
export function nextOccurrenceDay(schedule: RecurringSchedule, today: string): string | null {
  if (schedule.isPaused || !DAY_PATTERN.test(today)) return null;

  const startsOn = startOfUtcDay(new Date(schedule.startsOn));
  if (Number.isNaN(startsOn.getTime())) return null;
  const endsOn = schedule.endsOn ? endOfUtcDay(new Date(schedule.endsOn)) : null;
  if (endsOn && Number.isNaN(endsOn.getTime())) return null;
  // As in `getDuePeriods`, a malformed stored marker is treated as absent.
  const lastGenerated =
    schedule.lastGeneratedFor && PERIOD_PATTERN.test(schedule.lastGeneratedFor)
      ? schedule.lastGeneratedFor
      : null;

  const from = utcDay(startsOn) > today ? utcDay(startsOn) : today;
  let period = from.slice(0, 7);
  // A month already added: the next is the month after it, whose day is after `from`.
  if (lastGenerated && period <= lastGenerated) period = nextPeriod(lastGenerated);
  let date = expenseDateForPeriod(period, schedule.dayOfMonth);
  // This month's day has passed: the next is next month's, which is always after `from`.
  if (utcDay(date) < from) date = expenseDateForPeriod(nextPeriod(period), schedule.dayOfMonth);
  if (endsOn && date > endsOn) return null;
  return utcDay(date);
}
