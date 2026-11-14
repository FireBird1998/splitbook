/** Shared Header scene choices and display rules; no device or framework state. */
import { z } from 'zod';
import { getGroupTheme } from './group-themes';
import { groupCurrencies, type GroupCurrencyList } from './group-currencies';
import { deriveTripCodes } from './trip-codes';
import {
  dayCount,
  daysBetween,
  orderedTripDays,
  tripDayNumber,
  TRIP_SUMMARY_MAX_DAYS,
} from './trip-summary';
import { expenseDay } from './expense-day';
import { counted, SEPARATOR } from './separator';
import type { GroupCategory } from './types';

export const HEADER_SCENE_IDS = ['beach', 'sakura', 'eco-city', 'mountain-village'] as const;
export const HEADER_SCENES = [
  { id: 'beach', name: 'Beach' },
  { id: 'sakura', name: 'Sakura' },
  { id: 'eco-city', name: 'Eco city' },
  { id: 'mountain-village', name: 'Mountain village' },
] as const;
export const HEADER_TIMES = ['auto', 'morning', 'day', 'sunset', 'night'] as const;
export const groupHeaderSchema = z.object({
  style: z.enum(['classic', 'scene']),
  scene: z.enum(HEADER_SCENE_IDS),
  time: z.enum(HEADER_TIMES),
});
export type GroupHeader = z.infer<typeof groupHeaderSchema>;
export const DEFAULT_GROUP_HEADER: Readonly<GroupHeader> = {
  style: 'classic',
  scene: 'beach',
  time: 'auto',
};

/** A newer server or an old malformed row must never make a whole Group unreadable. */
export function readStoredGroupHeader(value: unknown): GroupHeader | undefined {
  const parsed = groupHeaderSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Off changes only the displayed style; the remembered scene and time survive. */
export function readGroupHeader(header?: unknown, enabled = true): GroupHeader {
  const value = readStoredGroupHeader(header) ?? DEFAULT_GROUP_HEADER;
  return { ...value, style: enabled ? value.style : 'classic' };
}

/** A viewer supplies their local hour when opening or returning; no timer or zone guess. */
export function headerTimeOfDay(
  time: GroupHeader['time'],
  localHour: number,
): Exclude<GroupHeader['time'], 'auto'> {
  if (time !== 'auto') return time;
  if (localHour >= 5 && localHour < 10) return 'morning';
  if (localHour >= 10 && localHour < 17) return 'day';
  if (localHour >= 17 && localHour < 20) return 'sunset';
  return 'night';
}

type TripDates = { startDate?: Date | string | null; endDate?: Date | string | null };

function headerTripDays(dates: TripDates) {
  return orderedTripDays(
    dates.startDate ? expenseDay(dates.startDate) : null,
    dates.endDate ? expenseDay(dates.endDate) : null,
  );
}

/** `today` is the viewer's local calendar day; stored Trip dates remain UTC calendar days. */
export function todayTripDay(dates: TripDates, today: string): number | null {
  const { start, end } = headerTripDays(dates);
  if (!start || !end || today > end) return null;
  return tripDayNumber(today, start);
}

/**
 * The words beside a Trip's day squares, the same on the web and Android: where the Trip is
 * today, how soon it starts, or that it is over. Null without both dates or the viewer's day.
 */
export function tripDayCaption(dates: TripDates, today: string): string | null {
  const { start, end } = headerTripDays(dates);
  // The viewer's day is unknown until their clock is read; say nothing rather than guess.
  if (!start || !end || !today) return null;
  const days = dayCount(start, end);
  if (today > end) return `Trip over${SEPARATOR}${counted(days, 'day')}`;
  const number = tripDayNumber(today, start);
  if (number !== null) return `Day ${number} of ${days}`;
  const wait = dayCount(today, start) - 1;
  return wait === 1 ? 'Starts tomorrow' : `Starts in ${counted(wait, 'day')}`;
}

/** Card facts shared by the two renderers. Only a date-bounded Theme gets Trip facts. */
export function headerCard(
  group: GroupCurrencyList &
    TripDates & {
      name: string;
      category: GroupCategory;
      members: readonly unknown[];
    },
  today: string,
) {
  const theme = getGroupTheme(group.category);
  const { start, end } = headerTripDays(group);
  return {
    name: group.name,
    theme: theme.label,
    members: group.members.length,
    currencies: groupCurrencies(group),
    trip:
      theme.dates === 'bounded'
        ? {
            route: deriveTripCodes(group.name),
            start,
            end,
            days:
              start && end && dayCount(start, end) <= TRIP_SUMMARY_MAX_DAYS
                ? daysBetween(start, end)
                : [],
            today: todayTripDay(group, today),
            caption: tripDayCaption(group, today),
          }
        : null,
  };
}
