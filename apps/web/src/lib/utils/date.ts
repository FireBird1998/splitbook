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
