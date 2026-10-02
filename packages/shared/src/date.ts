import {
  format,
  formatDistanceToNow,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
  subDays,
  isToday,
  isYesterday,
} from 'date-fns';

/**
 * Format a date for display.
 */
export function formatDate(date: Date | string): string {
  const d = new Date(date);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d, yyyy');
}

/**
 * Format a date with time.
 */
export function formatDateTime(date: Date | string): string {
  const d = new Date(date);
  if (isToday(d)) return `Today at ${format(d, 'h:mm a')}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, 'h:mm a')}`;
  return format(d, "MMM d, yyyy 'at' h:mm a");
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/**
 * Get date range for quick filters.
 */
export function getQuickFilterDates(filter: string): { from: Date; to: Date } | null {
  const now = new Date();

  switch (filter) {
    case 'thisWeek':
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: now,
      };
    case 'lastWeek': {
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      return {
        from: lastWeekStart,
        to: endOfWeek(lastWeekStart, { weekStartsOn: 1 }),
      };
    }
    case 'thisMonth':
      return {
        from: startOfMonth(now),
        to: now,
      };
    case 'lastMonth':
      return {
        from: startOfMonth(subMonths(now, 1)),
        to: endOfMonth(subMonths(now, 1)),
      };
    case 'last30Days':
      return {
        from: subDays(now, 30),
        to: now,
      };
    default:
      return null;
  }
}

/**
 * Format a date for API query parameter (ISO date string).
 */
export function toDateParam(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve an inclusive `dateTo` filter bound. Date-only strings (`yyyy-MM-dd`)
 * parse as UTC midnight, which would silently drop expenses later on the final
 * day — so they are widened to end-of-day UTC. Full ISO timestamps are
 * respected as-is. Boundaries are UTC, per the repo's UTC-storage convention.
 */
export function toInclusiveDateToBound(dateTo: string): Date {
  return DATE_ONLY_PATTERN.test(dateTo) ? new Date(`${dateTo}T23:59:59.999Z`) : new Date(dateTo);
}

function monthDate(month: string): Date {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid Month.');
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number - 1, 1);
}

/** The calendar Month containing a date in the device's local timezone. */
export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Move a Month key by a number of calendar months, including across years. */
export function shiftMonthKey(month: string, offset: number): string {
  const date = monthDate(month);
  date.setMonth(date.getMonth() + offset);
  return currentMonthKey(date);
}

/**
 * Inclusive ISO bounds for a local calendar Month. Construct both midnights in
 * local time so the window follows calendar days across daylight-saving changes.
 */
export function getLocalMonthIsoRange(month: string): { dateFrom: string; dateTo: string } {
  const start = monthDate(month);
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return {
    dateFrom: start.toISOString(),
    dateTo: new Date(next.getTime() - 1).toISOString(),
  };
}

/** 0 is Sunday and 6 is Saturday, as `Date.prototype.getDay` counts them. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const weekdayCodes = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// CLDR 48 week data: the regions whose week doesn't start on Monday, the world default.
const regionFirstDays = new Map(
  (
    [
      [
        0,
        'AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW',
      ],
      [5, 'MV'],
      [6, 'AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'],
    ] as const
  ).flatMap(([weekday, regions]) => regions.split(' ').map((region) => [region, weekday] as const)),
);

/**
 * The first day of the week for a BCP 47 locale such as `en-IN`: its `fw` preference when it
 * has one, otherwise its region's, otherwise Monday. Hermes has no `Intl.Locale` week info.
 */
export function localeFirstWeekday(locale: string): Weekday {
  const preference = /-u-(?:[a-z\d]{2,8}-)*?fw-([a-z]{3})(?:-|$)/i.exec(locale)?.[1];
  const preferred = weekdayCodes.indexOf(preference?.toLowerCase() ?? '');
  if (preferred >= 0) return preferred as Weekday;
  const region = /^[a-z]{2,3}(?:[-_][a-z]{4})?[-_]([a-z]{2})(?:[-_]|$)/i.exec(locale)?.[1];
  return regionFirstDays.get(region?.toUpperCase() ?? '') ?? 1;
}

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  weekday: Weekday;
  today: boolean;
  selected: boolean;
}

export interface CalendarMonth {
  month: string;
  /** The column order, starting with the first weekday. */
  weekdays: Weekday[];
  /** Rows of seven; cells before the 1st and after the last day are null. */
  weeks: (CalendarDay | null)[][];
  /** The neighbouring Months, or null beyond the years a Month key can hold. */
  previous: string | null;
  next: string | null;
}

/**
 * Lay out a calendar Month (`YYYY-MM`) in weeks starting on `firstWeekday`. Days are compared
 * as YYYY-MM-DD strings, so no timezone can shift today or the selection onto another day.
 */
export function monthGrid(
  month: string,
  { firstWeekday, today, selected }: { firstWeekday: Weekday; today: string; selected?: string },
): CalendarMonth {
  const start = monthDate(month);
  const year = start.getFullYear(),
    index = start.getMonth();
  const length = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const first = new Date(Date.UTC(year, index, 1)).getUTCDay();
  const cells: (CalendarDay | null)[] = Array((first - firstWeekday + 7) % 7).fill(null);
  for (let day = 1; day <= length; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({
      date,
      day,
      weekday: ((first + day - 1) % 7) as Weekday,
      today: date === today,
      selected: date === selected,
    });
  }
  while (cells.length % 7) cells.push(null);
  const neighbour = (offset: number) => {
    const key = shiftMonthKey(month, offset);
    return /^[1-9]\d{3}-/.test(key) ? key : null;
  };
  return {
    month,
    weekdays: Array.from({ length: 7 }, (_, column) => ((firstWeekday + column) % 7) as Weekday),
    weeks: Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7)),
    previous: neighbour(-1),
    next: neighbour(1),
  };
}
