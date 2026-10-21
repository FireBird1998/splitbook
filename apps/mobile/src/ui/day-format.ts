import { gregorianLocale, toDateParam } from '@splitbook/shared/date';

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

const formats = new Map<string, Intl.DateTimeFormat>();
/**
 * Spells dates in the device's language on the Gregorian calendar that Splitbook's dates use,
 * whatever the locale's own (fa-IR's is Persian). If a platform can't, they're Gregorian in
 * English. Hermes takes the calendar from the locale's `-u-ca-` extension. A formatter keeps the
 * zone it was made in, so each is kept for the phone's zone at the time, and a phone that
 * changes zone gets new ones.
 */
export function gregorianDateFormat(options: Intl.DateTimeFormatOptions) {
  const { locale, timeZone } = readPhoneCalendar();
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

const english = (locale: string) => /^en(?:[-_]|$)/i.test(locale);

/**
 * A day as Android spells it, day first whatever order the device locale uses (#640):
 * "Mon 19 Oct", "19 Oct 2026" or "Monday 19 October 2026", on US phones too. The words and digits
 * are the device's, on the Gregorian calendar.
 *
 * Only a locale that puts the month before the day is rebuilt from its parts, and English
 * always, so every English phone reads the same, without commas. A locale that is already day
 * first keeps its own words between them ("lunes, 19 de octubre de 2026", "Mo., 19. Okt."),
 * and one that writes the month as a number, such as Japanese or Korean, keeps its own order,
 * since "19 10" would read as neither. A platform that can't give the parts gets the locale's
 * own spelling.
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
  try {
    const parts = format.formatToParts(date);
    const at = (type: Intl.DateTimeFormatPartTypes) =>
      parts.findIndex((each) => each.type === type);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts[at(type)]?.value;
    const named = part('month');
    const monthFirst = at('month') < at('day');
    if (named && !/\p{Nd}/u.test(named) && (monthFirst || english(readPhoneCalendar().locale)))
      return [weekday && part('weekday'), part('day'), named, year && part('year')]
        .filter(Boolean)
        .join(' ');
  } catch {
    // No formatToParts on this platform.
  }
  return format.format(date);
}

/**
 * "1:44 PM", or "13:44", as the device's clock reads. Android's clock puts U+202F before AM and
 * PM, which the app's font lacks, so it is a no-break space here (#766): Android draws a missing
 * character from a wider fallback font than it measured the line in, and the time spilled out.
 */
export const spellTime = (date: Date) =>
  gregorianDateFormat({ hour: 'numeric', minute: '2-digit' })
    .format(date)
    .replace(/\u202f/g, '\u00a0');

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
