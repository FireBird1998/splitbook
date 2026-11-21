import { gregorianLocale } from '@splitbook/shared/date';
import { expenseDate, expenseDay } from '@splitbook/shared/expense-day';
import { NO_BREAK_SPACE } from '@splitbook/shared/separator';
import type { DayKey } from '@splitbook/shared/zoned-calendar';
import { phoneDay, readPhoneCalendar } from '../data/phone-clock';

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
  /** Join the day and its month with a no-break space, where they are rebuilt: "6 Nov". */
  together?: boolean;
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
  { weekday, month = 'short', year, timeZone, together }: DaySpelling = {},
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
      return [
        weekday && part('weekday'),
        together ? `${part('day')}${NO_BREAK_SPACE}${named}` : [part('day'), named].join(' '),
        year && part('year'),
      ]
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

/**
 * A moment, its day first: "19 Oct, 1:44 PM", or as `spelling` spells the day. Its day and
 * month are joined by a no-break space, so a record's "Fri 6 Nov 2026" never breaks between
 * them (the Designer's review of #899).
 */
export const spellMoment = (date: Date, spelling: DaySpelling = {}) =>
  `${spellDay(date, { ...spelling, together: true })}, ${spellTime(date)}`;

/**
 * A calendar day's key (`YYYY-MM-DD`), such as an Expense's date or a Month's day, spelled as
 * `spellDay` spells a day (#1286). It is read at midnight UTC and spelled in UTC, so no zone can
 * move it. Once the phone's zone changes while the app runs, Hermes keeps the zone the app started
 * in for its dates while Intl follows the new one (#1283): a key read into a local date and
 * spelled in the phone's zone names the day before.
 */
export const spellDayKey = (day: DayKey, spelling: Omit<DaySpelling, 'timeZone'> = {}) =>
  spellDay(expenseDate(day), { ...spelling, timeZone: 'UTC' });

/** The day before a day key: `dayBefore('2026-03-01')` is `2026-02-28`. */
export const dayBefore = (day: DayKey): DayKey =>
  expenseDay(expenseDate(day).getTime() - 24 * 60 * 60 * 1000);

/** "Today" or "Yesterday" when the day `day` names is one of them, by `today`'s key; otherwise null. */
export function nearDayKey(day: DayKey, today: DayKey) {
  return day === today ? 'Today' : day === dayBefore(today) ? 'Yesterday' : null;
}

/**
 * "Today" or "Yesterday" when the moment's day is one of them on the phone, otherwise null. Both
 * days are the phone's, so they follow its zone while the app runs (#1298).
 */
export const nearDay = (date: Date, now: number) => nearDayKey(phoneDay(date), phoneDay(now));

/** "Today", "Yesterday" on the phone (#1298), or the day a key names with its year: "19 Oct 2026". */
export const recentDay = (day: DayKey, now = Date.now()) =>
  nearDayKey(day, phoneDay(now)) ?? spellDayKey(day, { year: true });
