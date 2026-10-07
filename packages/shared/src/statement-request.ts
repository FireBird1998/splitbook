/** Server-rendered statement navigation: no additional JSON read or query cache. */
import { isCalendarDay, isTimeZone, type ExportRequest, type QueryValues } from './export-request';
export function statementPath(
  groupId: string,
  options: Pick<ExportRequest, 'from' | 'to' | 'timeZone'> & { wholeTrip?: boolean },
) {
  const entries = [
    ['tz', options.timeZone],
    ['from', options.from],
    ['to', options.to],
    ['scope', options.wholeTrip ? 'trip' : undefined],
  ];
  const query = entries
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
    .join('&');
  return `/groups/${encodeURIComponent(groupId)}/statement?${query}`;
}
export function parseStatementQuery(values: QueryValues) {
  const from = values.get('from') || undefined;
  const to = values.get('to') || undefined;
  const timeZone = values.get('tz') || 'UTC';
  const scope = values.get('scope');
  if (
    !isTimeZone(timeZone) ||
    Boolean(from) !== Boolean(to) ||
    (from && to && (!isCalendarDay(from) || !isCalendarDay(to) || from > to)) ||
    (scope !== null && scope !== 'trip')
  )
    throw new RangeError('Invalid statement period or time zone');
  return { from, to, timeZone, wholeTrip: scope === 'trip' };
}
