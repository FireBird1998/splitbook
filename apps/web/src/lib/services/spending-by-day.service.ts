import type { Types } from 'mongoose';
import type { SpendingByDayRead } from '@splitbook/shared/spending-by-day-read';
import type { MonthKey } from '@splitbook/shared/zoned-calendar';

/** The Expenses one Month of Spending by day reads: the member's, in their Groups (#1273). */
export function spendingByDayFilter(
  userId: string,
  groupIds: readonly Types.ObjectId[],
  month: MonthKey,
): Record<string, unknown> {
  void userId;
  void groupIds;
  void month;
  throw new Error('Not built yet');
}

/** One Month of the member's Spending by day across their Groups (#1273). */
export async function getSpendingByDay(
  userId: string,
  options: { month: MonthKey; timeZone: string; now?: Date },
): Promise<SpendingByDayRead> {
  void userId;
  void options;
  throw new Error('Not built yet');
}
