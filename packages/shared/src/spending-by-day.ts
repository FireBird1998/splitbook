/**
 * Spending by day (#1271, #1272): a member's own share of one Month's Expenses, day by day, for
 * the Android Home card and Spending screen, and the server read they come from (#1273).
 *
 * - An Expense counts for the member's own share of it, by the rule the monthly spending figures
 *   use (`memberShareMinor`), so a Month's total here equals that Month there. An Expense they
 *   have no share in is left out, even when they paid for it.
 * - An Expense belongs to the calendar day it is dated (`expenseDay`): no time zone moves it.
 * - Currencies are never added together or converted.
 */
import { format } from 'date-fns';
import { fullAmount } from './compact-amount';
import { getCurrency, getCurrencyPrecision } from './currency';
import { expenseDay, expenseLocalDate } from './expense-day';
import { sumMinorAmounts } from './exact-money';
import { memberShareMinor, type InsightExpense } from './insights';
import { isMonthKey, lastMonths, type DayKey, type Instant, type MonthKey } from './zoned-calendar';

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
  /** The member's share of the Month. */
  totalMinor: number;
  /** How many days had spending: the length of `days`. */
  dayCount: number;
  /** Only days with a share, oldest first. An empty day is not listed. */
  days: DaySpending[];
  /** The Expenses the member has a share in, by day and then in the order given. */
  expenses: DayShare<E>[];
}

/** The member's share of one Month's spending, by day and currency. */
export interface MemberSpendingByDay<E extends DayExpense> {
  month: MonthKey;
  currencies: CurrencyDays<E>[];
}

/**
 * The member's share of a Month's Expenses, per currency: the Month's total, the days with
 * spending (oldest first) and the Expenses they have a share in, by day and then in the order
 * given. The currency with the most such Expenses comes first, then by code, as the monthly
 * spending read orders them. Expenses dated in another Month count for nothing. The caller gives
 * only Expenses the member may see, in currencies Splitbook supports.
 */
export function memberSpendingByDay<E extends DayExpense>({
  memberId,
  month,
  expenses,
}: {
  memberId: string;
  month: MonthKey;
  expenses: Iterable<E>;
}): MemberSpendingByDay<E> {
  if (!isMonthKey(month)) throw new RangeError('Invalid Month');
  const byCurrency = new Map<string, DayShare<E>[]>();
  for (const expense of expenses) {
    const day = expenseDay(expense.date);
    if (!day.startsWith(`${month}-`)) continue;
    const shareMinor = memberShareMinor(expense, memberId);
    if (shareMinor === 0) continue;
    const shares = byCurrency.get(expense.currency) ?? [];
    shares.push({ expense, day, shareMinor });
    byCurrency.set(expense.currency, shares);
  }

  const currencies = [...byCurrency].map(([currency, shares]): CurrencyDays<E> => {
    // A stable sort: one day's Expenses keep the order given.
    shares.sort((a, b) => compareText(a.day, b.day));
    const days: DaySpending[] = [];
    for (const { day, shareMinor } of shares) {
      const last = days[days.length - 1];
      if (last?.day === day) last.shareMinor = sumMinorAmounts([last.shareMinor, shareMinor]);
      else days.push({ day, shareMinor });
    }
    return {
      currency,
      totalMinor: sumMinorAmounts(days.map((day) => day.shareMinor)),
      dayCount: days.length,
      days,
      expenses: shares,
    };
  });
  currencies.sort(
    (a, b) => b.expenses.length - a.expenses.length || compareText(a.currency, b.currency),
  );
  return { month, currencies };
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** How strongly a day is tinted: 0 for nothing, then four fixed steps. */
export type DayTint = 0 | 1 | 2 | 3 | 4;

/**
 * Where a currency's tint steps up, in whole units: at its base, twice it and five times it, as
 * the board draws rupees (₹500, ₹1,000, ₹2,500). Each base was of similar worth to ₹500 when the
 * table was made (November 2026), so a day costs about the same tint in any currency. Steps never
 * change with the month. A tint choice only: no amount is converted.
 */
const TINT_BASE: Readonly<Record<string, number>> = {
  INR: 500,
  JPY: 1_000,
  KRW: 10_000,
  IDR: 100_000,
  PHP: 500,
  RUB: 500,
  THB: 200,
  TWD: 200,
  TRY: 200,
  MXN: 100,
  ZAR: 100,
  CZK: 100,
  CNY: 50,
  HKD: 50,
  SEK: 50,
  NOK: 50,
  DKK: 50,
  PLN: 20,
  AED: 20,
  SAR: 20,
  MYR: 20,
  BRL: 20,
  CAD: 10,
  AUD: 10,
  NZD: 10,
  SGD: 10,
};
/** The rest, such as euros, dollars and pounds: 5, 10 and 25. */
const DEFAULT_TINT_BASE = 5;

/** A day's tint for the member's share of it: nothing, then up one step at each edge. */
export function dayTint(amountMinor: number, currency: string): DayTint {
  if (amountMinor <= 0) return 0;
  const places = getCurrency(currency) ? getCurrencyPrecision(currency) : 2;
  const base = (TINT_BASE[currency] ?? DEFAULT_TINT_BASE) * 10 ** places;
  return (1 + [base, 2 * base, 5 * base].filter((edge) => amountMinor >= edge).length) as DayTint;
}

/*
 * Spending by day's words for a Month or a day, read from its key (#1283). Each key becomes a
 * local date by `expenseLocalDate` and is written by date-fns, which reads that same local date
 * back: no Intl and no zone. Once the phone's zone changes while the app runs, Hermes keeps the
 * zone the app started in for its dates but Intl follows the new one, so a key read by
 * `toLocaleDateString` can name the Month or day before it.
 */

/** A Month's name, as a Group's Expenses spell their Month: "November". */
export function spendingMonthName(month: MonthKey): string {
  return format(expenseLocalDate(`${month}-01`), 'MMMM');
}

/** A Month with its year, as Spending titles it: "November 2026". */
export function spendingMonthTitle(month: MonthKey): string {
  return format(expenseLocalDate(`${month}-01`), 'MMMM yyyy');
}

/** A day as Spending heads its Expenses: "Mon 16 Nov". */
export function spendingDayHeading(day: DayKey): string {
  return format(expenseLocalDate(day), 'EEE d MMM');
}

/** A day as a screen reader says it: "16 November". */
export function spendingDayReadAloud(day: DayKey): string {
  return format(expenseLocalDate(day), 'd MMMM');
}

/**
 * A day's share as a screen reader says it: the date and the full amount, never the short form
 * a cell shows. "13 November, ₹1,240,000.00".
 */
export function dayShareReadAloud(day: DayKey, amountMinor: number, currency: string): string {
  return `${spendingDayReadAloud(day)}, ${fullAmount(amountMinor, currency)}`;
}

/** How many Months Spending by day reaches: the current one and the eleven before it. */
export const SPENDING_BY_DAY_MONTHS = 12;

/**
 * The Months Spending by day can read, oldest first; the last is the current Month in the
 * viewer's zone, as the phone's clock gives it. Days themselves follow the Expense day rule, so
 * the zone only decides which Month is current.
 */
export function spendingByDayMonths({ now, timeZone }: { now: Instant; timeZone: string }) {
  return lastMonths(SPENDING_BY_DAY_MONTHS, { now, timeZone });
}

/** The Month a client asked for: one of `spendingByDayMonths`, or a RangeError. */
export function readSpendingByDayMonth(
  value: unknown,
  clock: { now: Instant; timeZone: string },
): MonthKey {
  const months: unknown[] = spendingByDayMonths(clock);
  if (!months.includes(value))
    throw new RangeError(
      `Ask for this Month or one of the ${SPENDING_BY_DAY_MONTHS - 1} before it, written YYYY-MM.`,
    );
  return value as MonthKey;
}
