import { formatDate } from '@splitbook/shared/date';
import { expenseLocalDate } from '@splitbook/shared/expense-day';
import type { GroupTheme } from '@splitbook/shared/group-themes';

type Day = string | Date | null | undefined;

/**
 * "Sep 1, 2026 – Sep 5, 2026", "Starts Sep 1, 2026", or, with `tracking`, a Household's
 * "Tracking since Sep 1, 2026". A Group's dates are calendar days, the same in every zone (#437).
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
