import { expenseMonthRange } from '@splitbook/shared/expense-day';

/** Only a canonical first page pays for the widget's independent Recent ledger. */
export function widgetRecentGroup(
  path: string,
  month: string,
  householdId: string | null,
): string | null {
  const expense = /^\/api\/groups\/([^/]+)\/expenses\?(.+)$/.exec(path);
  if (!expense) return null;
  const query = new URLSearchParams(expense[2]);
  if (
    query.get('page') !== '1' ||
    [...query.keys()].some(
      (key) => !['page', 'limit', 'includeMemberBreakdown', 'dateFrom', 'dateTo'].includes(key),
    )
  )
    return null;
  if (query.has('dateFrom') || query.has('dateTo')) {
    const current = expenseMonthRange(month);
    if (
      expense[1] !== householdId ||
      query.get('dateFrom') !== current.dateFrom ||
      query.get('dateTo') !== current.dateTo
    )
      return null;
  }
  return expense[1];
}
