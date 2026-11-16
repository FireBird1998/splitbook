/**
 * Spending by day (#1271, #1272): a member's own share of one Month's Expenses, day by day.
 */
import type { InsightExpense } from './insights';
import type { DayKey, MonthKey } from './zoned-calendar';

/** An Expense as Spending by day reads it; the caller's other fields are kept as they are. */
export type DayExpense = Pick<
  InsightExpense,
  'currency' | 'date' | 'moneyVersion' | 'splitBetween'
>;

/** One day with spending: the member's share of that day's Expenses. */
export interface DaySpending {
  day: DayKey;
  shareMinor: number;
}

/** An Expense the member has a share in, with the day it belongs to and their share of it. */
export interface DayShare<E extends DayExpense> {
  expense: E;
  day: DayKey;
  shareMinor: number;
}

/** One currency's Month. */
export interface CurrencyDays<E extends DayExpense> {
  currency: string;
  totalMinor: number;
  dayCount: number;
  days: DaySpending[];
  expenses: DayShare<E>[];
}

/** The member's share of one Month's spending, by day and currency. */
export interface MemberSpendingByDay<E extends DayExpense> {
  month: MonthKey;
  currencies: CurrencyDays<E>[];
}

export function memberSpendingByDay<E extends DayExpense>(input: {
  memberId: string;
  month: MonthKey;
  expenses: Iterable<E>;
}): MemberSpendingByDay<E> {
  void input;
  throw new Error('Not built yet');
}

/** How strongly a day is tinted: 0 for nothing, then four fixed steps. */
export type DayTint = 0 | 1 | 2 | 3 | 4;

export function dayTint(amountMinor: number, currency: string): DayTint {
  void amountMinor;
  void currency;
  throw new Error('Not built yet');
}

export function dayShareReadAloud(day: DayKey, amountMinor: number, currency: string): string {
  void day;
  void amountMinor;
  void currency;
  throw new Error('Not built yet');
}
