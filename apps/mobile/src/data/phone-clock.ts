import {
  dayKeyInZone,
  isTimeZone,
  type DayKey,
  type Instant,
  type MonthKey,
} from '@splitbook/shared/zoned-calendar';

/**
 * Which day, Month and hour it is on this phone (#1298), and its locale and zone.
 *
 * Once the phone's time zone changes while the app runs, Hermes keeps the zone the app started in
 * for `Date` (its local getters and date strings without an offset), while Intl follows the
 * phone's new zone (#1283). So "today" worked out from a `Date` stays the old zone's day until a
 * cold start. Every Today, Yesterday, this Month and Auto Header scene hour reads the phone's day
 * and hour here instead: through Intl, in the zone Intl reports now.
 */

/** The phone's locale, e.g. "en-IN" or "fa-IR", and its time zone. */
export interface PhoneCalendar {
  locale: string;
  timeZone?: string;
}

let reading: PhoneCalendar | null = null;
/**
 * The phone's locale and time zone. Reading them builds a formatter, which is slow on Hermes, so
 * one reading serves every date spelled in the same turn of the event loop, such as a render or
 * a Date sheet's Month. The next turn reads them again, so a phone that changes its language or
 * zone is followed.
 */
export function readPhoneCalendar(): PhoneCalendar {
  if (!reading) {
    const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
    reading = { locale, timeZone };
    void Promise.resolve().then(() => {
      reading = null;
    });
  }
  return reading;
}

/** The phone's zone as Intl reads it now, or undefined when the platform gives none it can use. */
export function phoneTimeZone(): string | undefined {
  const { timeZone } = readPhoneCalendar();
  return isTimeZone(timeZone) ? timeZone : undefined;
}

const instantDate = (moment: Instant) =>
  moment instanceof Date
    ? moment
    : new Date(typeof moment === 'string' ? Date.parse(moment) : moment);

/** The day of a date in Date's own zone: only for a platform whose Intl names no zone. */
const dateDay = (date: Date): DayKey =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The day (`YYYY-MM-DD`) a moment falls on in the phone's zone: today's unless a moment is given. */
export function phoneDay(moment: Instant = Date.now()): DayKey {
  const zone = phoneTimeZone();
  return zone ? dayKeyInZone(moment, zone) : dateDay(instantDate(moment));
}

/** The Month (`YYYY-MM`) a moment falls in, in the phone's zone: this Month unless one is given. */
export const phoneMonth = (moment: Instant = Date.now()): MonthKey => phoneDay(moment).slice(0, 7);

const hours = new Map<string, Intl.DateTimeFormat>();
/** The hour (0–23) on the phone's clock at a moment: now unless one is given. */
export function phoneHour(moment: Instant = Date.now()): number {
  const date = instantDate(moment);
  const zone = phoneTimeZone();
  if (!zone) return date.getHours();
  let format = hours.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US-u-nu-latn', {
      hour: 'numeric',
      hour12: false,
      timeZone: zone,
    });
    hours.set(zone, format);
  }
  const hour = Number(format.formatToParts(date).find((part) => part.type === 'hour')?.value);
  // Some engines write midnight as 24 with a 24-hour clock.
  return Number.isInteger(hour) ? hour % 24 : date.getHours();
}
