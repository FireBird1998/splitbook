/**
 * The Spending by day read contract (#1273): one Month of the member's own share across their
 * Groups, per currency, by day, with the Expenses behind it. Amounts are exact minor units.
 */

export interface SpendingByDayExpenseRead {
  _id: string;
  group: { _id: string; name: string };
  description: string;
  tag: string;
  paidBy: { _id: string; name?: string }[];
  day: string;
  shareMinor: number;
  amountMinor: number;
}

export interface SpendingByDayRead {
  month: string;
  timeZone: string;
  currencies: {
    currency: string;
    totalMinor: number;
    dayCount: number;
    days: { day: string; shareMinor: number }[];
    expenses: SpendingByDayExpenseRead[];
  }[];
}

/** Keep malformed remote data out of the views and out of error messages. */
export class SpendingByDayReadError extends Error {
  constructor() {
    super('Unable to load your spending by day. Please retry.');
    this.name = 'SpendingByDayReadError';
  }
}

export function parseSpendingByDayResponse(value: unknown): SpendingByDayRead {
  void value;
  throw new Error('Not built yet');
}
