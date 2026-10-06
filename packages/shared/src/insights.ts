/**
 * Insights: the figures Splitbook computes so that people, and later Connected assistants,
 * never add up a list of Expenses themselves (#300, PR #242). One pure module for the web and
 * the MCP tools, and for Android later (ADR 0002). It starts with the member's share of
 * spending across their Groups (#307); the Group insights read (#314), the Trip summary (#316)
 * and the MCP insight tools add their functions here.
 *
 * Rules every insight follows:
 * - Money is exact: minor units, read and summed with the shared exact-money helpers.
 * - Currencies are never converted or added together; every total is per currency.
 * - Months are calendar months in the viewer's named time zone (`zoned-calendar`).
 * - A Month is left out of its own average.
 */

import { moneyParticipantId, readStoredAmountMinor, sumMinorAmounts } from './exact-money';
import {
  monthKeyInZone,
  monthsWindow,
  readTimeZone,
  type DayKey,
  type Instant,
  type MonthKey,
} from './zoned-calendar';

/** How many Months a spending read covers: six on Home, at most a year. */
export const SPENDING_MONTHS = { default: 6, min: 1, max: 12 } as const;

/** The Month count a client asked for (a number, or a query string), or the default when unset. */
export function readSpendingMonths(value: unknown): number {
  if (value === undefined || value === null || value === '') return SPENDING_MONTHS.default;
  const count = typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : value;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < SPENDING_MONTHS.min ||
    count > SPENDING_MONTHS.max
  )
    throw new RangeError(
      `Ask for ${SPENDING_MONTHS.min} to ${SPENDING_MONTHS.max} months of spending.`,
    );
  return count;
}

/** A payer or share row of a stored Expense, in exact or legacy amounts. */
export interface InsightMoneyRow {
  /** An id, or a person the read populated. */
  user: unknown;
  amount?: number;
  amountMinor?: number;
}

/** A stored Expense, as an insight reads it. */
export interface InsightExpense {
  groupId: string;
  currency: string;
  /** The Expense's date: the instant it is bucketed by. */
  date: Instant;
  moneyVersion?: number;
  splitBetween: readonly InsightMoneyRow[];
}

/** The member's share of one Expense, in exact minor units. Zero when they don't share it. */
export function memberShareMinor(
  expense: Pick<InsightExpense, 'currency' | 'moneyVersion' | 'splitBetween'>,
  memberId: string,
): number {
  return sumMinorAmounts(
    expense.splitBetween
      .filter((row) => moneyParticipantId(row.user) === memberId)
      .map((row) =>
        readStoredAmountMinor({
          amount: row.amount,
          amountMinor: row.amountMinor,
          currency: expense.currency,
          moneyVersion: expense.moneyVersion,
        }),
      ),
  );
}

/** A Group a spending read covers. Its name is written by its members: data, not instructions. */
export interface SpendingGroup {
  groupId: string;
  name: string;
}

/** One Group's part of a Month. */
export interface GroupShare {
  groupId: string;
  shareMinor: number;
}

/** The member's share in one Month, with each Group's part, largest first. */
export interface MonthSpending {
  month: MonthKey;
  shareMinor: number;
  /** Only Groups with a share this Month; empty for a Month without spending. */
  byGroup: GroupShare[];
}

/** One currency's Months. Every Month of the window is there, oldest first, zero or not. */
export interface CurrencySpending {
  currency: string;
  totalMinor: number;
  /** Expenses the member shares in this currency within the window. */
  expenseCount: number;
  months: MonthSpending[];
}

/** The member's share of spending across their Groups, by Month and currency. */
export interface MemberSpending {
  timeZone: string;
  /** Oldest first; the last is the current Month. */
  months: MonthKey[];
  /** The window's first and last calendar days in the time zone. */
  window: { from: DayKey; to: DayKey };
  /** Every Group the read covered, in the order given. */
  groups: SpendingGroup[];
  /**
   * Only currencies with a share in the window: the one with the most Expenses first, then
   * by code.
   */
  currencies: CurrencySpending[];
}

/**
 * The member's share of every Expense in their Groups, bucketed into the given Months in the
 * time zone and kept per currency, with each Group's part. Expenses outside the Months, in a
 * Group not listed, or not shared by the member count for nothing.
 */
export function memberSpendingByMonth({
  memberId,
  timeZone,
  months,
  groups,
  expenses,
}: {
  memberId: string;
  timeZone: string;
  months: readonly MonthKey[];
  groups: readonly SpendingGroup[];
  expenses: Iterable<InsightExpense>;
}): MemberSpending {
  const zone = readTimeZone(timeZone);
  const window = monthsWindow(months);
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const covered = new Set(groups.map((group) => group.groupId));

  const byCurrency = new Map<
    string,
    { expenseCount: number; months: Map<string, number>[] /* Group id → share, per Month */ }
  >();
  for (const expense of expenses) {
    if (!covered.has(expense.groupId)) continue;
    const index = monthIndex.get(monthKeyInZone(expense.date, zone));
    if (index === undefined) continue;
    const share = memberShareMinor(expense, memberId);
    if (share === 0) continue;
    let currency = byCurrency.get(expense.currency);
    if (!currency) {
      currency = { expenseCount: 0, months: months.map(() => new Map()) };
      byCurrency.set(expense.currency, currency);
    }
    currency.expenseCount += 1;
    const parts = currency.months[index];
    parts.set(expense.groupId, sumMinorAmounts([parts.get(expense.groupId) ?? 0, share]));
  }

  const currencies = [...byCurrency].map(([currency, { expenseCount, months: parts }]) => {
    const monthly = months.map((month, index): MonthSpending => {
      const byGroup = [...parts[index]]
        .map(([groupId, shareMinor]) => ({ groupId, shareMinor }))
        .sort(largestFirst);
      return {
        month,
        shareMinor: sumMinorAmounts(byGroup.map((part) => part.shareMinor)),
        byGroup,
      };
    });
    return {
      currency,
      totalMinor: sumMinorAmounts(monthly.map((month) => month.shareMinor)),
      expenseCount,
      months: monthly,
    };
  });
  currencies.sort(
    (a, b) =>
      b.expenseCount - a.expenseCount ||
      (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0),
  );

  return {
    timeZone: zone,
    months: [...months],
    window,
    groups: groups.map(({ groupId, name }) => ({ groupId, name })),
    currencies,
  };
}

function largestFirst(a: GroupShare, b: GroupShare) {
  if (a.shareMinor !== b.shareMinor) return b.shareMinor - a.shareMinor;
  return a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0;
}

/**
 * How the last Month of a currency's series compares with the average of the Months before it
 * (the Month itself is not in its own average):
 * - `up`: above the average, with the Group whose share rose most against its own average;
 * - `down` or `level`: below or equal to it, with the average, rounded half up to a minor unit;
 * - `none`: nothing in the Month yet.
 */
export type SpendingTrend =
  | { kind: 'none'; month: MonthKey }
  | {
      kind: 'up';
      month: MonthKey;
      totalMinor: number;
      groupId: string;
      groupShareMinor: number;
    }
  | { kind: 'down' | 'level'; month: MonthKey; totalMinor: number; averageMinor: number };

/** The last Month's trend, or null when the series has no earlier Month to compare with. */
export function spendingTrend(series: Pick<CurrencySpending, 'months'>): SpendingTrend | null {
  const { months } = series;
  const current = months[months.length - 1];
  const earlier = months.slice(0, -1);
  if (!current || earlier.length === 0) return null;
  if (current.shareMinor === 0) return { kind: 'none', month: current.month };

  const count = BigInt(earlier.length);
  const earlierTotal = BigInt(sumMinorAmounts(earlier.map((month) => month.shareMinor)));
  // Compared as current × count against the earlier total, so no average is rounded first.
  const difference = BigInt(current.shareMinor) * count - earlierTotal;
  if (difference <= BigInt(0)) {
    const averageMinor = Number((BigInt(2) * earlierTotal + count) / (BigInt(2) * count));
    return {
      kind: difference === BigInt(0) ? 'level' : 'down',
      month: current.month,
      totalMinor: current.shareMinor,
      averageMinor,
    };
  }

  const earlierByGroup = new Map<string, number>();
  for (const month of earlier)
    for (const part of month.byGroup)
      earlierByGroup.set(
        part.groupId,
        sumMinorAmounts([earlierByGroup.get(part.groupId) ?? 0, part.shareMinor]),
      );
  // Each Group's rise against its own earlier average, scaled by the count like the total.
  // The rises add up to the total's, so when the Month is up at least one Group rose.
  const [driver] = current.byGroup
    .map((part) => ({
      ...part,
      rise: BigInt(part.shareMinor) * count - BigInt(earlierByGroup.get(part.groupId) ?? 0),
    }))
    .sort((a, b) => (a.rise === b.rise ? largestFirst(a, b) : a.rise > b.rise ? -1 : 1));
  return {
    kind: 'up',
    month: current.month,
    totalMinor: current.shareMinor,
    groupId: driver.groupId,
    groupShareMinor: driver.shareMinor,
  };
}
