import { format, isToday, isYesterday } from 'date-fns';
import { formatDate } from '@splitbook/shared/date';

/** When a Connected assistant last used its connection, as Settings and Group settings show it. */
export function lastUsedLabel(value: string | null): string {
  if (!value) return 'Not used yet';
  const date = new Date(value);
  if (isToday(date)) return `Last used ${format(date, 'HH:mm')}`;
  if (isYesterday(date)) return 'Last used yesterday';
  return `Last used ${formatDate(date, { omitCurrentYear: true })}`;
}
