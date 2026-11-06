import { format } from 'date-fns';
import { formatDate } from '@splitbook/shared/date';
import { expenseLocalDate } from '@splitbook/shared/expense-day';
import type { GroupTheme } from '@splitbook/shared/group-themes';

type Day = string | Date | null | undefined;

/**
 * "1 Sep 2026 – 5 Sep 2026", "Starts 1 Sep 2026", or, with `tracking`, a Household's
 * "Tracking since 1 Sep 2026". A Group's dates are calendar days, the same in every zone (#437).
 */
export function groupDatesLabel(
  theme: Pick<GroupTheme, 'dates' | 'signature'>,
  startDate: Day,
  endDate: Day,
  { tracking = false }: { tracking?: boolean } = {},
): string | null {
  const day = (date: string | Date) => formatDate(expenseLocalDate(date));
  if (theme.dates === 'bounded') {
    if (startDate && endDate) return `${day(startDate)} – ${day(endDate)}`;
    return startDate ? `Starts ${day(startDate)}` : null;
  }
  return tracking && theme.signature === 'monthCycle' && startDate
    ? `Tracking since ${day(startDate)}`
    : null;
}

/**
 * A Trip's dates as its strip shows them (#646), naming a month or year once where both ends
 * share it: "17–20 Sep 2026", "28 Sep – 2 Oct 2026", "30 Dec 2026 – 2 Jan 2027". One day is
 * "17 Sep 2026", a start alone "Starts 17 Sep 2026", and no start is null. Calendar days, the
 * same in every zone (#437); never "Today".
 */
export function tripDateRange(startDate: Day, endDate: Day): string | null {
  if (!startDate) return null;
  const start = expenseLocalDate(startDate);
  if (!endDate) return `Starts ${format(start, 'd MMM yyyy')}`;
  const end = expenseLocalDate(endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth && start.getDate() === end.getDate()) return format(start, 'd MMM yyyy');
  if (sameMonth) return `${format(start, 'd')}–${format(end, 'd MMM yyyy')}`;
  if (sameYear) return `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`;
  return `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`;
}
