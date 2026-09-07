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
