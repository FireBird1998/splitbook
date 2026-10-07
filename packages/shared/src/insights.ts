/**
 * Insights: the figures Splitbook computes so that people, and later Connected assistants,
 * never add up a list of Expenses themselves (#300, PR #242). One pure module for the web and
 * the MCP tools, and for Android later (ADR 0002). It holds the member's share of spending
 * across their Groups (#307), one Month across them by Category and by Group (#308), and a
 * Group's Months compared with the Months before them (#314); the Trip summary (#316) and the
 * MCP insight tools add their functions here.
 *
 * Rules every insight follows:
 * - Money is exact: minor units, read and summed with the shared exact-money helpers.
 * - Currencies are never converted or added together; every total is per currency.
 * - Months are calendar months in the viewer's named time zone (`zoned-calendar`).
 * - A Month is left out of its own average.
 */

import { CATEGORY_IDS } from './categories';
import { moneyParticipantId, readStoredAmountMinor, sumMinorAmounts } from './exact-money';
import {
  addMonths,
  dayKeyInZone,
  monthKeyInZone,
  monthsBetween,
  monthsWindow,
  readTimeZone,
  type DayKey,
  type Instant,
  type MonthKey,
} from './zoned-calendar';
import { MoneyValidationError } from './exact-money';
import { nextOccurrenceDay } from './recurring-due-periods';
import { findReferencedTag, type IdentityTag } from './tag-identity';

/** How many Months a spending read covers: six on Home, at most a year. */
export const SPENDING_MONTHS = { default: 6, min: 1, max: 12 } as const;

/** A count of Months a client asked for (a number, or a query string), or the default when unset. */
function readMonthCount(
  value: unknown,
  bounds: { default: number; min: number; max: number },
  refusal: string,
): number {
  if (value === undefined || value === null || value === '') return bounds.default;
  const count = typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : value;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < bounds.min ||
    count > bounds.max
  )
    throw new RangeError(refusal);
  return count;
}

/** The Month count a client asked for (a number, or a query string), or the default when unset. */
export function readSpendingMonths(value: unknown): number {
  return readMonthCount(
    value,
    SPENDING_MONTHS,
    `Ask for ${SPENDING_MONTHS.min} to ${SPENDING_MONTHS.max} months of spending.`,
  );
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

// --- A Group's Months (#314) -----------------------------------------------------------------

/**
 * How many Months before the Month a Group's insights compare it with: the Insights tab offers
 * 1, 6 and 12, and 6 is the default. Like the Connected assistants' `compare_months`, at most a
 * year (PR #242).
 */
export const COMPARE_MONTHS = { default: 6, min: 1, max: 12, choices: [1, 6, 12] } as const;

/** The earlier-Month count a client asked for (a number, or a query string), or the default. */
export function readCompareMonths(value: unknown): number {
  return readMonthCount(
    value,
    COMPARE_MONTHS,
    `Compare with ${COMPARE_MONTHS.min} to ${COMPARE_MONTHS.max} earlier months.`,
  );
}

/** One value per Month, such as a Month's Spent, in exact minor units. */
export interface MonthValue {
  month: MonthKey;
  valueMinor: number;
}

/** Up, down or level against the average, as the average is shown (rounded to a minor unit). */
export type ChangeDirection = 'up' | 'down' | 'level';

/**
 * A Month against the average of the Months before it. The Month itself is never in its own
 * average, so a big Month can't hide behind its own weight (#300, PR #242).
 */
export interface MonthComparison {
  month: MonthKey;
  valueMinor: number;
  /** The Months averaged, oldest first: never the Month itself. Empty when there are none. */
  earlierMonths: MonthKey[];
  earlierTotalMinor: number;
  /** Rounded half up to a minor unit; null when there is no earlier Month. */
  averageMinor: number | null;
  /** The Month minus the average as shown; null when there is no earlier Month. */
  differenceMinor: number | null;
  /** Null when there is no earlier Month. */
  direction: ChangeDirection | null;
  /**
   * The difference as a percentage of the average as shown, to one decimal place (half away
   * from zero). Null when there is no earlier Month or the average is zero.
   */
  changePercent: number | null;
}

/** A non-negative total over a count of Months, rounded half up to a minor unit. */
function averageOf(totalMinor: number, count: number): number {
  return Number((BigInt(2) * BigInt(totalMinor) + BigInt(count)) / BigInt(2 * count));
}

/** `numerator / denominator` (denominator positive), rounded half away from zero. */
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < BigInt(0) ? -numerator : numerator;
  const rounded = (magnitude * BigInt(2) + denominator) / (BigInt(2) * denominator);
  return numerator < BigInt(0) ? -rounded : rounded;
}

/**
 * The earlier Months a Month is compared with: up to `previousMonths` of them, ending with the
 * Month before it, and none before `since` (the Group's first Month), so Months before a Group
 * existed never pull its average down. Never the Month itself.
 */
export function earlierMonths(
  month: MonthKey,
  { previousMonths, since = null }: { previousMonths: number; since?: MonthKey | null },
): MonthKey[] {
  if (!Number.isSafeInteger(previousMonths) || previousMonths < 0)
    throw new RangeError('Invalid earlier-Month count');
  if (previousMonths === 0) return [];
  const first = addMonths(month, -previousMonths);
  return monthsBetween(since !== null && since > first ? since : first, addMonths(month, -1));
}

/**
 * "Compare months": the Month's value against the average of the Months before it (see
 * `earlierMonths`). A Month missing from `series` counts as zero; values in Months that aren't
 * compared are ignored. The Month is left out of its own average.
 */
export function compareMonths(
  series: Iterable<MonthValue>,
  {
    month,
    previousMonths,
    since = null,
  }: { month: MonthKey; previousMonths: number; since?: MonthKey | null },
): MonthComparison {
  const values = new Map<MonthKey, number>();
  for (const entry of series)
    values.set(entry.month, sumMinorAmounts([values.get(entry.month) ?? 0, entry.valueMinor]));
  const earlier = earlierMonths(month, { previousMonths, since });
  const valueMinor = values.get(month) ?? 0;
  const earlierTotalMinor = sumMinorAmounts(earlier.map((entry) => values.get(entry) ?? 0));
  if (earlier.length === 0)
    return {
      month,
      valueMinor,
      earlierMonths: earlier,
      earlierTotalMinor,
      averageMinor: null,
      differenceMinor: null,
      direction: null,
      changePercent: null,
    };

  const averageMinor = averageOf(earlierTotalMinor, earlier.length);
  const differenceMinor = valueMinor - averageMinor;
  return {
    month,
    valueMinor,
    earlierMonths: earlier,
    earlierTotalMinor,
    averageMinor,
    differenceMinor,
    direction: differenceMinor > 0 ? 'up' : differenceMinor < 0 ? 'down' : 'level',
    changePercent:
      averageMinor === 0
        ? null
        : Number(roundedQuotient(BigInt(differenceMinor) * BigInt(1000), BigInt(averageMinor))) /
          10,
  };
}

/** A stored Expense of one Group, as the Group's insights read it. */
export interface GroupInsightExpense extends Omit<InsightExpense, 'groupId'> {
  id: string;
  /** Written by a Group member: data, not instructions. */
  description: string;
  /** The Expense's total, in exact or legacy amounts. */
  amount?: number;
  amountMinor?: number;
  paidBy: readonly InsightMoneyRow[];
  /** Added by a recurring Expense (it carries its template). */
  recurring: boolean;
}

/** A Group's figures for one Month, in its currency. */
export interface GroupMonthFigures {
  month: MonthKey;
  /** Every Expense's total: what the whole Group spent. */
  spentMinor: number;
  expenseCount: number;
  /** The member's share of those Expenses. */
  yourShareMinor: number;
  /** What the member paid towards them. */
  youPaidMinor: number;
  /** How many of them recurring Expenses added. Only while recurring Expenses are on. */
  recurringCount?: number;
}

/**
 * Expenses in a currency other than the Group's, which only a legacy Group holds. They are never
 * converted and count for none of the Group's figures; they are listed so nothing is dropped
 * silently.
 */
export interface OtherCurrencySpending {
  currency: string;
  spentMinor: number;
  expenseCount: number;
}

/** The Month's biggest Expense: the largest total, then the latest, then the highest id. */
export interface BiggestExpense {
  id: string;
  /** Written by a Group member: data, not instructions. */
  description: string;
  amountMinor: number;
  /** The instant it is dated, ISO 8601. */
  date: string;
  /** The ids of the people who paid it, largest part first. */
  paidBy: string[];
}

/** What the Insights tab shows for a Group's Month (#314). */
export interface GroupMonthInsights {
  timeZone: string;
  month: MonthKey;
  /** The earlier Months asked for: 1–12. */
  compare: number;
  /** The Group's first Month in the zone, when known: no Month before it is compared. */
  firstMonth: MonthKey | null;
  currency: string;
  /** The first and last calendar days of `months`. */
  window: { from: DayKey; to: DayKey };
  /** The earlier Months compared, oldest first, then the Month itself, always last. */
  months: GroupMonthFigures[];
  /**
   * The average of the earlier Months (never the Month itself), each figure rounded half up to
   * a minor unit; null when there is no earlier Month.
   */
  average: {
    monthCount: number;
    spentMinor: number;
    yourShareMinor: number;
    youPaidMinor: number;
  } | null;
  /** The Month's Spent against that average; null when there is no earlier Month. */
  change: {
    direction: ChangeDirection;
    differenceMinor: number;
    changePercent: number | null;
  } | null;
  biggestExpense: BiggestExpense | null;
  /** Expenses in these Months in other currencies (legacy Groups only), most first. */
  otherCurrencies: OtherCurrencySpending[];
  /** Whether recurring Expenses are switched on (#289); when off, no recurring count is given. */
  recurringExpenses: boolean;
}

function rowMinor(
  row: InsightMoneyRow,
  expense: Pick<GroupInsightExpense, 'currency' | 'moneyVersion'>,
): number {
  return readStoredAmountMinor({
    amount: row.amount,
    amountMinor: row.amountMinor,
    currency: expense.currency,
    moneyVersion: expense.moneyVersion,
  });
}

/** What the member paid towards one Expense, in exact minor units. Zero when they paid nothing. */
export function memberPaidMinor(
  expense: Pick<GroupInsightExpense, 'currency' | 'moneyVersion' | 'paidBy'>,
  memberId: string,
): number {
  return sumMinorAmounts(
    expense.paidBy
      .filter((row) => moneyParticipantId(row.user) === memberId)
      .map((row) => rowMinor(row, expense)),
  );
}

/** An Expense's total, in exact minor units. */
export function expenseTotalMinor(
  expense: Pick<GroupInsightExpense, 'currency' | 'moneyVersion' | 'amount' | 'amountMinor'>,
): number {
  return readStoredAmountMinor({
    amount: expense.amount,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    moneyVersion: expense.moneyVersion,
  });
}

function instantTime(instant: Instant): number {
  const time = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(time)) throw new RangeError('Invalid instant');
  return time;
}

interface Candidate {
  expense: GroupInsightExpense;
  totalMinor: number;
}

function isBigger(a: Candidate, b: Candidate): boolean {
  if (a.totalMinor !== b.totalMinor) return a.totalMinor > b.totalMinor;
  const [aTime, bTime] = [instantTime(a.expense.date), instantTime(b.expense.date)];
  if (aTime !== bTime) return aTime > bTime;
  return a.expense.id > b.expense.id;
}

function biggestExpense({ expense, totalMinor }: Candidate): BiggestExpense {
  return {
    id: expense.id,
    description: expense.description,
    amountMinor: totalMinor,
    date: new Date(instantTime(expense.date)).toISOString(),
    paidBy: expense.paidBy
      .map((row) => ({ id: moneyParticipantId(row.user), minor: rowMinor(row, expense) }))
      .sort((a, b) => b.minor - a.minor || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => row.id),
  };
}

/**
 * A Group's figures for a Month and the Months before it, in the viewer's time zone and the
 * Group's currency, in exact minor units (#314):
 * - each Month's Spent (the whole Group), Expense count, the member's share and what they paid,
 *   and, only while recurring Expenses are on (#289), how many of them recurring Expenses added;
 * - the average of the earlier Months, which leaves the Month itself out, and the Month's Spent
 *   against it;
 * - the Month's biggest Expense.
 *
 * One currency per Group: an Expense in another currency (a legacy Group's) counts for none of
 * these figures and is listed in `otherCurrencies` instead, never converted. Expenses outside
 * the Months compared count for nothing.
 */
export function groupMonthInsights({
  memberId,
  timeZone,
  month,
  compare,
  firstMonth = null,
  currency,
  expenses,
  recurringExpenses,
}: {
  memberId: string;
  timeZone: string;
  month: MonthKey;
  compare: number;
  firstMonth?: MonthKey | null;
  currency: string;
  expenses: Iterable<GroupInsightExpense>;
  recurringExpenses: boolean;
}): GroupMonthInsights {
  const zone = readTimeZone(timeZone);
  const months = [...earlierMonths(month, { previousMonths: compare, since: firstMonth }), month];
  const index = new Map(months.map((key, at) => [key, at]));
  const figures = months.map(
    (key): GroupMonthFigures => ({
      month: key,
      spentMinor: 0,
      expenseCount: 0,
      yourShareMinor: 0,
      youPaidMinor: 0,
      ...(recurringExpenses ? { recurringCount: 0 } : {}),
    }),
  );
  const others = new Map<string, OtherCurrencySpending>();
  let biggest: Candidate | null = null;

  for (const expense of expenses) {
    const at = index.get(monthKeyInZone(expense.date, zone));
    if (at === undefined) continue;
    const totalMinor = expenseTotalMinor(expense);
    if (expense.currency !== currency) {
      const other = others.get(expense.currency) ?? {
        currency: expense.currency,
        spentMinor: 0,
        expenseCount: 0,
      };
      other.spentMinor = sumMinorAmounts([other.spentMinor, totalMinor]);
      other.expenseCount += 1;
      others.set(expense.currency, other);
      continue;
    }
    const figure = figures[at];
    figure.spentMinor = sumMinorAmounts([figure.spentMinor, totalMinor]);
    figure.expenseCount += 1;
    figure.yourShareMinor = sumMinorAmounts([
      figure.yourShareMinor,
      memberShareMinor(expense, memberId),
    ]);
    figure.youPaidMinor = sumMinorAmounts([
      figure.youPaidMinor,
      memberPaidMinor(expense, memberId),
    ]);
    if (figure.recurringCount !== undefined && expense.recurring) figure.recurringCount += 1;
    if (at === months.length - 1) {
      const candidate = { expense, totalMinor };
      if (!biggest || isBigger(candidate, biggest)) biggest = candidate;
    }
  }

  const against = (value: (figure: GroupMonthFigures) => number) =>
    compareMonths(
      figures.map((figure) => ({ month: figure.month, valueMinor: value(figure) })),
      { month, previousMonths: compare, since: firstMonth },
    );
  const spent = against((figure) => figure.spentMinor);
  const share = against((figure) => figure.yourShareMinor);
  const paid = against((figure) => figure.youPaidMinor);

  return {
    timeZone: zone,
    month,
    compare,
    firstMonth,
    currency,
    window: monthsWindow(months),
    months: figures,
    average:
      spent.averageMinor === null
        ? null
        : {
            monthCount: spent.earlierMonths.length,
            spentMinor: spent.averageMinor,
            yourShareMinor: share.averageMinor ?? 0,
            youPaidMinor: paid.averageMinor ?? 0,
          },
    change:
      spent.direction === null
        ? null
        : {
            direction: spent.direction,
            differenceMinor: spent.differenceMinor ?? 0,
            changePercent: spent.changePercent,
          },
    biggestExpense: biggest ? biggestExpense(biggest) : null,
    otherCurrencies: [...others.values()].sort(
      (a, b) =>
        b.expenseCount - a.expenseCount ||
        (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0),
    ),
    recurringExpenses,
  };
}

// --- One Month across the member's Groups (#308) ----------------------------------------------

/*
 * Home's "Where it went" (the member's share by Category) and the Groups table's "Spent in
 * <Month>" (what each Group spent).
 */

/**
 * An Expense's Category, as insights count it: one of the global Categories (`categories`).
 * A stored value outside them, or none, counts as Other. Spending is never grouped by Tag
 * across Groups: a Tag belongs to one Group, so two Tags with the same name are two Tags.
 */
export function insightCategory(value: unknown): string {
  return typeof value === 'string' && CATEGORY_IDS.includes(value) ? value : 'other';
}

/** A stored Expense of one of the member's Groups, as the Month in detail reads it. */
export interface MonthDetailExpense extends InsightExpense {
  /** The Expense's total, in exact or legacy amounts: what its Group spent. */
  amount?: number;
  amountMinor?: number;
  /** Its Category, as stored; see `insightCategory`. */
  category?: string;
}

/** One Category's part of the member's share in the Month. */
export interface CategoryShare {
  category: string;
  shareMinor: number;
  /** Expenses of this Category the member shares in the Month. */
  expenseCount: number;
}

/** The member's share in one currency in the Month, by Category. */
export interface CategorySpending {
  currency: string;
  totalMinor: number;
  expenseCount: number;
  /** Only Categories with a share: the largest first, then by Category. */
  categories: CategoryShare[];
}

/** What a Group spent in one currency in the Month: every Expense, whoever shares it. */
export interface GroupSpent {
  currency: string;
  totalMinor: number;
  expenseCount: number;
}

/** One Group's spending in the Month. */
export interface GroupMonthSpending {
  groupId: string;
  /** Only currencies with Expenses, the one with the most first, then by code. */
  spent: GroupSpent[];
}

/** One Month in detail, across the member's Groups. */
export interface MonthDetail {
  month: MonthKey;
  /**
   * The member's share by Category, across every Group, per currency. Only currencies with a
   * share: the one with the most Expenses first, then by code.
   */
  byCategory: CategorySpending[];
  /** Every Group the read covered, in the order given, with what it spent. */
  groups: GroupMonthSpending[];
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const mostExpensesFirst = (
  a: { currency: string; expenseCount: number },
  b: { currency: string; expenseCount: number },
) => b.expenseCount - a.expenseCount || byCode(a.currency, b.currency);

/**
 * The Month in detail, in the time zone: the member's share of each Category, and what each
 * Group spent (each Expense's total, `expenseTotalMinor`). An Expense outside the Month or in a
 * Group not listed counts for nothing; one the member doesn't share counts toward its Group's
 * spending only.
 */
export function spendingInMonth({
  memberId,
  timeZone,
  month,
  groups,
  expenses,
}: {
  memberId: string;
  timeZone: string;
  month: MonthKey;
  groups: readonly Pick<SpendingGroup, 'groupId'>[];
  expenses: Iterable<MonthDetailExpense>;
}): MonthDetail {
  const zone = readTimeZone(timeZone);
  // Refuses a malformed Month before anything is counted.
  monthsWindow([month]);
  const spentByGroup = new Map(
    groups.map(({ groupId }) => [groupId, new Map<string, Omit<GroupSpent, 'currency'>>()]),
  );
  const shareByCurrency = new Map<
    string,
    { expenseCount: number; categories: Map<string, Omit<CategoryShare, 'category'>> }
  >();

  for (const expense of expenses) {
    const spent = spentByGroup.get(expense.groupId);
    if (!spent || monthKeyInZone(expense.date, zone) !== month) continue;
    const before = spent.get(expense.currency) ?? { totalMinor: 0, expenseCount: 0 };
    spent.set(expense.currency, {
      totalMinor: sumMinorAmounts([before.totalMinor, expenseTotalMinor(expense)]),
      expenseCount: before.expenseCount + 1,
    });

    const share = memberShareMinor(expense, memberId);
    if (share === 0) continue;
    let currency = shareByCurrency.get(expense.currency);
    if (!currency) {
      currency = { expenseCount: 0, categories: new Map() };
      shareByCurrency.set(expense.currency, currency);
    }
    currency.expenseCount += 1;
    const category = insightCategory(expense.category);
    const part = currency.categories.get(category) ?? { shareMinor: 0, expenseCount: 0 };
    currency.categories.set(category, {
      shareMinor: sumMinorAmounts([part.shareMinor, share]),
      expenseCount: part.expenseCount + 1,
    });
  }

  const byCategory = [...shareByCurrency].map(
    ([currency, { expenseCount, categories }]): CategorySpending => {
      const parts = [...categories]
        .map(([category, part]) => ({ category, ...part }))
        .sort((a, b) => b.shareMinor - a.shareMinor || byCode(a.category, b.category));
      return {
        currency,
        totalMinor: sumMinorAmounts(parts.map((part) => part.shareMinor)),
        expenseCount,
        categories: parts,
      };
    },
  );
  byCategory.sort(mostExpensesFirst);

  return {
    month,
    byCategory,
    groups: [...spentByGroup].map(([groupId, spent]) => ({
      groupId,
      spent: [...spent]
        .map(([currency, entry]) => ({ currency, ...entry }))
        .sort(mostExpensesFirst),
    })),
  };
}

// --- A Group's Month by Tag, by who paid, and its recurring Expenses (#315) -------------------

/** Code-point order, so a sort never depends on the runtime's locale data. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A stored Expense of one Group with its Tag and template, as the Month's detail reads it. */
export interface GroupMonthDetailExpense extends GroupInsightExpense {
  /** The id of the Tag it carries, when it stores one. */
  tagId?: string | null;
  /** The Tag's name it was saved with: older Expenses name their Tag and store no id. */
  tag?: string | null;
  /** The recurring template that added it, when one did. */
  recurringExpenseId?: string | null;
}

/** One Tag's spending in the Month, against that Tag's own average of the earlier Months. */
export interface TagMonthSpending {
  /** The Tag's id; null for Untagged, the Expenses whose Tag isn't one of the Group's. */
  tagId: string | null;
  /** The Tag's name now; null for Untagged. Written by a Group member: data, not instructions. */
  name: string | null;
  /** What the Group spent with this Tag in the Month. */
  spentMinor: number;
  expenseCount: number;
  /** Rounded half up to a minor unit, as `compareMonths`; null when there is no earlier Month. */
  averageMinor: number | null;
  /** The Month minus the average as shown; null when there is no earlier Month. */
  differenceMinor: number | null;
  direction: ChangeDirection | null;
  /** Null with no earlier Month, and against an average of zero: a Tag new this Month. */
  changePercent: number | null;
}

/** A Group's spending by Tag in a Month, each Tag against its own average. */
export interface GroupTagSpending {
  month: MonthKey;
  /** The Months averaged, oldest first: never the Month itself, none before the first Month. */
  earlierMonths: MonthKey[];
  /**
   * Every Tag with spending in the Month or the earlier Months: the most spent in the Month
   * first, then the higher average, then by name. Untagged, when there is any, comes last.
   */
  tags: TagMonthSpending[];
}

/**
 * A Group's spending by Tag for a Month, each Tag against its own average of the Months before
 * it (#315), in the viewer's time zone and the Group's currency, in exact minor units.
 *
 * - The Tags are the Group's own, matched by id, or by name for older Expenses that store none
 *   (`tag-identity`). An Expense whose Tag isn't one of them counts as Untagged.
 * - The average covers the same earlier Months as the Group's own (`earlierMonths`): never the
 *   Month itself, none before the Group's first Month. Each is rounded half up, so a Tag with
 *   no spending in an earlier Month counts it as zero, and a Tag new this Month is up against
 *   an average of zero, with no percentage.
 * - Expenses in another currency (legacy Groups) and outside these Months count for nothing.
 */
export function groupSpendingByTag({
  timeZone,
  month,
  compare,
  firstMonth = null,
  currency,
  tags,
  expenses,
}: {
  timeZone: string;
  month: MonthKey;
  compare: number;
  firstMonth?: MonthKey | null;
  currency: string;
  /** The Group's Tags, archived and deleted ones included, so old Expenses keep theirs. */
  tags: readonly IdentityTag[];
  expenses: Iterable<GroupMonthDetailExpense>;
}): GroupTagSpending {
  const zone = readTimeZone(timeZone);
  const earlier = earlierMonths(month, { previousMonths: compare, since: firstMonth });
  const counted = new Set([...earlier, month]);
  const groupTags = [...tags];
  // Keyed by Tag id; '' is Untagged, which no stored id can be.
  const byTag = new Map<string, { name: string | null; values: MonthValue[]; count: number }>();

  for (const expense of expenses) {
    if (expense.currency !== currency) continue;
    const at = monthKeyInZone(expense.date, zone);
    if (!counted.has(at)) continue;
    const tag = findReferencedTag(groupTags, {
      tagId: expense.tagId ?? undefined,
      tag: expense.tag ?? undefined,
    });
    const key = tag ? String(tag._id) : '';
    let entry = byTag.get(key);
    if (!entry) {
      entry = { name: tag ? tag.name : null, values: [], count: 0 };
      byTag.set(key, entry);
    }
    entry.values.push({ month: at, valueMinor: expenseTotalMinor(expense) });
    if (at === month) entry.count += 1;
  }

  const rows: TagMonthSpending[] = [];
  for (const [key, entry] of byTag) {
    const comparison = compareMonths(entry.values, {
      month,
      previousMonths: compare,
      since: firstMonth,
    });
    if (comparison.valueMinor === 0 && comparison.earlierTotalMinor === 0) continue;
    rows.push({
      tagId: key === '' ? null : key,
      name: entry.name,
      spentMinor: comparison.valueMinor,
      expenseCount: entry.count,
      averageMinor: comparison.averageMinor,
      differenceMinor: comparison.differenceMinor,
      direction: comparison.direction,
      changePercent: comparison.changePercent,
    });
  }
  rows.sort(
    (a, b) =>
      Number(a.tagId === null) - Number(b.tagId === null) ||
      b.spentMinor - a.spentMinor ||
      (b.averageMinor ?? 0) - (a.averageMinor ?? 0) ||
      byText(a.name ?? '', b.name ?? '') ||
      byText(a.tagId ?? '', b.tagId ?? ''),
  );
  return { month, earlierMonths: earlier, tags: rows };
}

/** What one person paid in a Month against their share of it. */
export interface MemberPaidAndShare {
  memberId: string;
  /** In the Group now. Someone who left keeps a row while the Month holds their Expenses. */
  isMember: boolean;
  paidMinor: number;
  shareMinor: number;
  /** Paid minus Share: above zero, they paid more than their share in this Month alone. */
  netMinor: number;
}

/**
 * Who paid in a Month (#315): each person's Paid against their Share of the Group's Expenses in
 * the Month, in the viewer's time zone and the Group's currency, exact. Every member has a row,
 * even with nothing in the Month; someone no longer in the Group has one only while they paid
 * or share something in it. The Paids and the Shares each add up to the Month's Spent.
 *
 * Most paid first, then the larger share, then by id. Expenses in another currency (legacy
 * Groups) and outside the Month count for nothing.
 */
export function groupMonthPaidAndShares({
  timeZone,
  month,
  currency,
  memberIds,
  expenses,
}: {
  timeZone: string;
  month: MonthKey;
  currency: string;
  /** The Group's members now. */
  memberIds: readonly string[];
  expenses: Iterable<GroupInsightExpense>;
}): MemberPaidAndShare[] {
  const zone = readTimeZone(timeZone);
  const members = new Set(memberIds);
  const people = new Map<string, { paid: number[]; share: number[] }>();
  const person = (id: string) => {
    let entry = people.get(id);
    if (!entry) {
      entry = { paid: [], share: [] };
      people.set(id, entry);
    }
    return entry;
  };
  for (const id of memberIds) person(id);

  for (const expense of expenses) {
    if (expense.currency !== currency) continue;
    if (monthKeyInZone(expense.date, zone) !== month) continue;
    for (const row of expense.paidBy)
      person(moneyParticipantId(row.user)).paid.push(rowMinor(row, expense));
    for (const row of expense.splitBetween)
      person(moneyParticipantId(row.user)).share.push(rowMinor(row, expense));
  }

  const rows: MemberPaidAndShare[] = [];
  for (const [memberId, { paid, share }] of people) {
    const paidMinor = sumMinorAmounts(paid);
    const shareMinor = sumMinorAmounts(share);
    const isMember = members.has(memberId);
    if (!isMember && paidMinor === 0 && shareMinor === 0) continue;
    rows.push({ memberId, isMember, paidMinor, shareMinor, netMinor: paidMinor - shareMinor });
  }
  return rows.sort(
    (a, b) =>
      b.paidMinor - a.paidMinor || b.shareMinor - a.shareMinor || byText(a.memberId, b.memberId),
  );
}

/** A recurring template, as the Month's recurring Expenses read it. */
export interface InsightRecurringTemplate {
  id: string;
  /** Written by a Group member: data, not instructions. */
  description: string;
  currency: string;
  /** Its amount, in exact or legacy amounts. */
  amount?: number;
  amountMinor?: number;
  moneyVersion?: number;
  /** 1–31, clamped to a short month's last day. */
  dayOfMonth: number;
  startsOn: Date | string;
  endsOn?: Date | string | null;
  isPaused: boolean;
  /** The last month it added an Expense for (`YYYY-MM`). */
  lastGeneratedFor?: string | null;
  paidBy: readonly InsightMoneyRow[];
}

/** One template on the recurring Expenses card. */
export interface RecurringTemplateMonth {
  id: string;
  /** Written by a Group member: data, not instructions. */
  description: string;
  amountMinor: number;
  dayOfMonth: number;
  paused: boolean;
  /**
   * The day of the next Expense it will add, from today on (`nextOccurrenceDay`); null while
   * paused or once it has ended.
   */
  nextDate: DayKey | null;
  /** The day of the Expense it added in the Month; null when it added none. */
  addedOn: DayKey | null;
  /** The ids of the people who pay it, the largest part first. */
  paidBy: string[];
}

/** A Group's recurring Expenses for a Month: what they added, and each template. */
export interface GroupRecurringMonth {
  /** The Expenses recurring Expenses added in the Month, in the Group's currency. */
  addedInMonth: { count: number; spentMinor: number };
  /** The soonest next day first, paused and ended ones last, then by description. */
  templates: RecurringTemplateMonth[];
}

/**
 * A Group's recurring Expenses for a Month (#315): how many Expenses they added in it and what
 * those came to, and each template's amount, schedule and next day. Only for a read while
 * recurring Expenses are switched on (#289); the caller sends nothing otherwise.
 *
 * - Days are calendar days, as a recurring Expense is dated. `now` gives today in the viewer's
 *   zone; the next day is the next Expense's not yet added (`nextOccurrenceDay`), so it never
 *   repeats the day of one already in the ledger.
 * - Exact, in the Group's currency. A template in another currency can't add an Expense to
 *   this Group (generation skips it), so it isn't listed.
 */
export function groupRecurringMonth({
  timeZone,
  month,
  currency,
  now,
  templates,
  expenses,
}: {
  timeZone: string;
  month: MonthKey;
  currency: string;
  now: Instant;
  templates: Iterable<InsightRecurringTemplate>;
  expenses: Iterable<GroupMonthDetailExpense>;
}): GroupRecurringMonth {
  const zone = readTimeZone(timeZone);
  const today = dayKeyInZone(now, zone);
  const added: number[] = [];
  const addedOn = new Map<string, { time: number; day: DayKey }>();
  for (const expense of expenses) {
    if (expense.currency !== currency || !expense.recurring) continue;
    if (monthKeyInZone(expense.date, zone) !== month) continue;
    added.push(expenseTotalMinor(expense));
    if (!expense.recurringExpenseId) continue;
    // One a month; were there two, the later one.
    const time = instantTime(expense.date);
    const previous = addedOn.get(expense.recurringExpenseId);
    if (!previous || time > previous.time)
      addedOn.set(expense.recurringExpenseId, { time, day: dayKeyInZone(expense.date, 'UTC') });
  }

  const rows: RecurringTemplateMonth[] = [];
  for (const template of templates) {
    if (template.currency !== currency) continue;
    let amountMinor: number;
    let paidBy: string[];
    try {
      amountMinor = expenseTotalMinor(template);
      paidBy = template.paidBy
        .map((row) => ({ id: moneyParticipantId(row.user), minor: rowMinor(row, template) }))
        .sort((a, b) => b.minor - a.minor || byText(a.id, b.id))
        .map((row) => row.id);
    } catch (error) {
      // Stored money that can't be read exactly: generation stops at the template too, and
      // Group settings shows its problem. Better left off than listed with a wrong amount.
      if (error instanceof MoneyValidationError) continue;
      throw error;
    }
    rows.push({
      id: template.id,
      description: template.description,
      amountMinor,
      dayOfMonth: template.dayOfMonth,
      paused: template.isPaused,
      nextDate: nextOccurrenceDay(template, today),
      addedOn: addedOn.get(template.id)?.day ?? null,
      paidBy,
    });
  }
  rows.sort(
    (a, b) =>
      Number(a.nextDate === null) - Number(b.nextDate === null) ||
      byText(a.nextDate ?? '', b.nextDate ?? '') ||
      byText(a.description, b.description) ||
      byText(a.id, b.id),
  );
  return {
    addedInMonth: { count: added.length, spentMinor: sumMinorAmounts(added) },
    templates: rows,
  };
}
