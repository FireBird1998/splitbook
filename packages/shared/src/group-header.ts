/** Shared Header scene choices and display rules; no device or framework state. */
import { z } from 'zod';
import { getGroupTheme } from './group-themes';
import { groupCurrencies, type GroupCurrencyList } from './group-currencies';
import { deriveTripCodes } from './trip-codes';
import { dayCount, daysBetween } from './trip-summary';
import { expenseDay } from './expense-day';
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

/** Off changes only the displayed style; the remembered scene and time survive. */
export function readGroupHeader(header?: GroupHeader | null, enabled = true): GroupHeader {
  const value = header ?? DEFAULT_GROUP_HEADER;
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

/** `today` is the viewer's local calendar day; stored Trip dates remain UTC calendar days. */
export function todayTripDay(dates: TripDates, today: string): number | null {
  if (!dates.startDate || !dates.endDate) return null;
  const start = expenseDay(dates.startDate),
    end = expenseDay(dates.endDate);
  return today < start || today > end ? null : dayCount(start, today);
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
  const start = group.startDate ? expenseDay(group.startDate) : null;
  const end = group.endDate ? expenseDay(group.endDate) : null;
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
            days: start && end ? daysBetween(start, end) : [],
            today: todayTripDay(group, today),
          }
        : null,
  };
}
