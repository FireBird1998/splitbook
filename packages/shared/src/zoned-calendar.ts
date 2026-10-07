/**
 * Calendar Months and days in a named IANA time zone, for insights (#307, PR #242).
 *
 * A Month is the viewer's own calendar month, so the zone always comes from the client and is
 * never the server's or the runtime's. Everything here reads the zone through
 * `Intl.DateTimeFormat#formatToParts` with an explicit `timeZone`, which Node, browsers and
 * Hermes on Android provide; Month arithmetic is plain integers. Nothing reads the process
 * time zone (the unit tests also run in Tongatapu, Kiritimati and Pago Pago, #227), and no
 * date library is needed (ADR 0002).
 *
 * Bucketing is by instant: an Expense stored at `2026-10-01T00:00:00Z` falls in September for
 * a viewer in New York, exactly as the Household Month lens filters it today.
 */

/** A calendar Month, `YYYY-MM`. */
export type MonthKey = string;
/** A calendar day, `YYYY-MM-DD`. */
export type DayKey = string;

/** An instant: a Date, an ISO timestamp or epoch milliseconds. */
export type Instant = Date | string | number;

/** A time zone Splitbook can't use: missing, not a named IANA zone, or unknown to the runtime. */
export class TimeZoneError extends RangeError {
  constructor() {
    super('Send a named IANA time zone, such as Asia/Kolkata.');
    this.name = 'TimeZoneError';
  }
}

// IANA names: letters first, then letters, digits, `_`, `-` and `+`, in `/`-separated parts,
// such as `America/Argentina/Buenos_Aires` or `Etc/GMT+5`. An offset such as `+05:30`, which
// some runtimes accept, is refused: it has no daylight-saving rules, so it isn't a zone.
const ZONE_NAME = /^[A-Za-z][A-Za-z\d_+-]*(?:\/[A-Za-z\d_+-]+)*$/;
const MAX_ZONE_LENGTH = 64;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone. Gregorian calendar and Latin digits whatever the runtime's locale. */
function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** True for a named IANA zone this runtime knows, such as `Asia/Kolkata` or `UTC`. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_ZONE_LENGTH || !ZONE_NAME.test(value))
    return false;
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
}

/** The zone, exactly as sent, or a `TimeZoneError`. */
export function readTimeZone(value: unknown): string {
  if (!isTimeZone(value)) throw new TimeZoneError();
  return value;
}

/** A calendar day in a zone, as numbers: month 1–12. */
export interface ZonedDay {
  year: number;
  month: number;
  day: number;
}

function epochMillis(instant: Instant): number {
  const time = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(time)) throw new RangeError('Invalid instant');
  return time;
}

/** The calendar day an instant falls on in a zone. */
export function zonedDay(instant: Instant, timeZone: string): ZonedDay {
  const parts = formatter(readTimeZone(timeZone)).formatToParts(epochMillis(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');
const monthKey = (year: number, month: number): MonthKey => `${pad(year, 4)}-${pad(month)}`;

/** The calendar Month (`YYYY-MM`) an instant falls in, in a zone. */
export function monthKeyInZone(instant: Instant, timeZone: string): MonthKey {
  const { year, month } = zonedDay(instant, timeZone);
  return monthKey(year, month);
}

/** The calendar day (`YYYY-MM-DD`) an instant falls on, in a zone. */
export function dayKeyInZone(instant: Instant, timeZone: string): DayKey {
  const { year, month, day } = zonedDay(instant, timeZone);
  return `${monthKey(year, month)}-${pad(day)}`;
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

function readMonth(month: MonthKey): { year: number; month: number } {
  const match = MONTH_KEY.exec(month);
  if (!match) throw new RangeError('Invalid Month');
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** True for a calendar Month written `YYYY-MM`, such as `2026-09`. */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY.test(value);
}

/**
 * Every Month from `from` to `to`, both included, oldest first. Empty when `from` is after
 * `to`. Months compare as text, since `YYYY-MM` sorts as the calendar does.
 */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  readMonth(from);
  readMonth(to);
  const months: MonthKey[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) {
    months.push(month);
    if (month === to) break;
  }
  return months;
}

/** A Month moved by whole months, across years: `addMonths('2026-01', -1)` is `2025-12`. */
export function addMonths(month: MonthKey, offset: number): MonthKey {
  if (!Number.isSafeInteger(offset)) throw new RangeError('Invalid Month offset');
  const start = readMonth(month);
  const index = start.year * 12 + (start.month - 1) + offset;
  const year = Math.floor(index / 12);
  if (year < 0 || year > 9999) throw new RangeError('Invalid Month');
  return monthKey(year, index - year * 12 + 1);
}

/** The `count` Months ending with the one `now` falls in, in the zone, oldest first. */
export function lastMonths(
  count: number,
  { now, timeZone }: { now: Instant; timeZone: string },
): MonthKey[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('Invalid Month count');
  const current = monthKeyInZone(now, timeZone);
  return Array.from({ length: count }, (_, index) => addMonths(current, index - count + 1));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** The first and last calendar days of consecutive Months, as the viewer reads the window. */
export function monthsWindow(months: readonly MonthKey[]): { from: DayKey; to: DayKey } {
  if (months.length === 0) throw new RangeError('No Months');
  const lastMonth = months[months.length - 1];
  const last = readMonth(lastMonth);
  return { from: `${months[0]}-01`, to: `${lastMonth}-${pad(daysInMonth(last.year, last.month))}` };
}

/** Midnight UTC on the 1st of a Month; `Date.UTC` alone would move years 0–99 into the 1900s. */
function utcMonthStart(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  return date.getTime();
}

/** No zone is more than 14 hours from UTC; a whole day either side covers every one. */
const DAY = 24 * 60 * 60 * 1000;

/**
 * UTC bounds, `from` inclusive and `to` exclusive, that hold every instant of these Months in
 * any zone. A read selects with them, then keeps what `monthKeyInZone` puts in a Month.
 */
export function monthsQueryRange(months: readonly MonthKey[]): { from: Date; to: Date } {
  if (months.length === 0) throw new RangeError('No Months');
  const first = readMonth(months[0]);
  const last = readMonth(months[months.length - 1]);
  return {
    from: new Date(utcMonthStart(first.year, first.month) - DAY),
    to: new Date(utcMonthStart(last.year, last.month + 1) + DAY),
  };
}
