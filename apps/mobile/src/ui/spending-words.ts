import { counted } from '@splitbook/shared/separator';

/** Spending by day's words (#1271), as the Home card and Spending both write them. */

/** A Month key's name in English, as a Group's Expenses spell their Month: "November". */
export const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString('en', { month: 'long' });

/** "12 days with spending", the count kept with its noun. */
export const spendingDays = (count: number) => `${counted(count, 'day')} with spending`;
