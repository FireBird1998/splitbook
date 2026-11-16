import { counted } from '@splitbook/shared/separator';

/**
 * Spending by day's words (#1271), as the Home card and Spending both write them. Month and day
 * names come from the shared helpers, from their keys (#1283).
 */

/** "12 days with spending", the count kept with its noun. */
export const spendingDays = (count: number) => `${counted(count, 'day')} with spending`;
