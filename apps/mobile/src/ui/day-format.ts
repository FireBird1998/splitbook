import { gregorianLocale, toDateParam } from '@splitbook/shared/date';

/** The device's locale, e.g. "en-IN" or "fa-IR". */
export const deviceLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;

const formats = new Map<string, Intl.DateTimeFormat>();
/**
 * Spells dates in the device's language on the Gregorian calendar that Splitbook's dates use,
 * whatever the locale's own (fa-IR's is Persian). If a platform can't, they're Gregorian in
 * English. Hermes takes the calendar from the locale's `-u-ca-` extension. A formatter keeps the
 * zone it was made in, so each is kept for the device's zone at the time, and a phone that
 * changes zone gets new ones.
 */
export function gregorianDateFormat(options: Intl.DateTimeFormatOptions) {
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const zoned: Intl.DateTimeFormatOptions = { timeZone, ...options };
  const key = `${locale} ${JSON.stringify(zoned)}`;
  let format = formats.get(key);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(gregorianLocale(locale), zoned);
    } catch {
      // A locale tag the platform rejects.
    }
    if (format?.resolvedOptions().calendar !== 'gregory')
      format = new Intl.DateTimeFormat('en-u-ca-gregory', zoned);
    formats.set(key, format);
  }
  return format;
}

/** How a day is spelled: the parts it shows besides its number and month. */
export interface DaySpelling {
  /** The weekday first: "Mon 19 Oct", "Monday 19 October 2026". */
  weekday?: 'short' | 'long';
  /** "Oct", the default, or "October". */
  month?: 'short' | 'long';
  /** The year last: "19 Oct 2026". */
  year?: boolean;
  /** The zone to read the day in, such as UTC for a Group's dates stored at UTC midnight. */
  timeZone?: string;
}

/**
 * A day as Android spells it, day first whatever order the device locale uses (#640):
 * "Mon 19 Oct", "19 Oct 2026" or "Monday 19 October 2026", on US phones too. The words and digits
 * are the device's, on the Gregorian calendar. A locale that writes the month as a number, such
 * as Japanese or Korean, keeps its own order, since "19 10" would read as neither.
 */
export function spellDay(
  date: Date,
  { weekday, month = 'short', year, timeZone }: DaySpelling = {},
) {
  const format = gregorianDateFormat({
    ...(weekday ? { weekday } : {}),
    day: 'numeric',
    month,
    ...(year ? { year: 'numeric' } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
  const parts = format.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)?.value;
  const named = part('month');
  if (!named || /\p{Nd}/u.test(named)) return format.format(date);
  return [weekday && part('weekday'), part('day'), named, year && part('year')]
    .filter(Boolean)
    .join(' ');
}

/** "1:44 PM", or "13:44", as the device's clock reads. */
export const spellTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** A moment, its day first: "19 Oct, 1:44 PM", or as `spelling` spells the day. */
export const spellMoment = (date: Date, spelling: DaySpelling = {}) =>
  `${spellDay(date, spelling)}, ${spellTime(date)}`;

/** "Today" or "Yesterday" when the day is one of them on this device, otherwise null. */
export function nearDay(date: Date, now: number) {
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const day = toDateParam(date);
  return day === toDateParam(today) ? 'Today' : day === toDateParam(yesterday) ? 'Yesterday' : null;
}

/** "Today", "Yesterday", or the day with its year: "19 Oct 2026". */
export const recentDay = (date: Date, now = Date.now()) =>
  nearDay(date, now) ?? spellDay(date, { year: true });
