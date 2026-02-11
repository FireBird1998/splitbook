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
} from "date-fns";

/**
 * Format a date for display.
 */
export function formatDate(date: Date | string): string {
  const d = new Date(date);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d, yyyy");
}

/**
 * Format a date with time.
 */
export function formatDateTime(date: Date | string): string {
  const d = new Date(date);
  if (isToday(d)) return `Today at ${format(d, "h:mm a")}`;
  if (isYesterday(d)) return `Yesterday at ${format(d, "h:mm a")}`;
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
export function getQuickFilterDates(
  filter: string
): { from: Date; to: Date } | null {
  const now = new Date();

  switch (filter) {
    case "thisWeek":
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: now,
      };
    case "lastWeek": {
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      return {
        from: lastWeekStart,
        to: endOfWeek(lastWeekStart, { weekStartsOn: 1 }),
      };
    }
    case "thisMonth":
      return {
        from: startOfMonth(now),
        to: now,
      };
    case "lastMonth":
      return {
        from: startOfMonth(subMonths(now, 1)),
        to: endOfMonth(subMonths(now, 1)),
      };
    case "last30Days":
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
  return format(date, "yyyy-MM-dd");
}

