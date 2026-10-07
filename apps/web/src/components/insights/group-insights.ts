/**
 * What a Group's Insights tab shows (#314), from the Group insights read: the Month and the
 * earlier-Month count in the address, the stat cards, and the monthly spending rows with their
 * average. Pure, so the cards, the chart, its tooltip and the table all say the same thing.
 *
 * A Month is a calendar month in the viewer's own time zone, and a read-only lens: the address
 * names one (`?month=2026-09`), and `?compare=` says how many Months before it to compare it
 * with (1, 6 or 12). The average never includes the Month itself.
 */
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { GroupInsightsRead } from '@splitbook/shared/group-insights-read';
import { COMPARE_MONTHS, type ChangeDirection } from '@splitbook/shared/insights';
import { addMonths, isMonthKey } from '@splitbook/shared/zoned-calendar';
import { monthLabel } from '@/components/dashboard/spending-chart';
import { groupTabHref } from '@/components/groups/group-tabs';

export type CompareChoice = (typeof COMPARE_MONTHS.choices)[number];
export const COMPARE_CHOICES: readonly CompareChoice[] = COMPARE_MONTHS.choices;
export const DEFAULT_COMPARE: CompareChoice = COMPARE_MONTHS.default;

/** The Month and the earlier-Month count the tab shows. */
export interface InsightsAddress {
  month: string;
  compare: CompareChoice;
}

interface SearchParamsLike {
  get(name: string): string | null;
}

const isCompareChoice = (value: number): value is CompareChoice =>
  (COMPARE_CHOICES as readonly number[]).includes(value);

/**
 * The tab's Month and count from the address. No Month, a malformed one or one after the
 * current Month shows the current Month; any count but 1, 6 or 12 shows 6.
 */
export function readInsightsAddress(
  params: SearchParamsLike,
  currentMonth: string,
): InsightsAddress {
  const month = params.get('month');
  const compare = Number(params.get('compare'));
  return {
    month: isMonthKey(month) && month <= currentMonth ? month : currentMonth,
    compare: isCompareChoice(compare) ? compare : DEFAULT_COMPARE,
  };
}

/**
 * The tab's address for a Month and count. It names only what isn't the default, so the bare
 * address always means "the current Month against the six before it".
 */
export function insightsHref(
  groupId: string,
  { month, compare }: InsightsAddress,
  currentMonth: string,
): string {
  const query = new URLSearchParams();
  if (month !== currentMonth) query.set('month', month);
  if (compare !== DEFAULT_COMPARE) query.set('compare', String(compare));
  return groupTabHref(groupId, 'insights', query);
}

/** "1 month", "6 months": the range switch's options. */
export const compareLabel = (count: number) => `${count} ${count === 1 ? 'month' : 'months'}`;

/** Where the Month navigation can go, and why it can't. */
export interface MonthSteps {
  previous: { month: string; label: string; reason: string | null };
  next: { month: string; label: string; reason: string | null };
}

/**
 * Previous and next Months. Next stops at the current Month; previous stops at the Group's
 * first Month once the read says which it is.
 */
export function monthSteps(
  month: string,
  { currentMonth, firstMonth }: { currentMonth: string; firstMonth: string | null },
): MonthSteps {
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const monthName = monthLabel(month, 'name');
  return {
    previous: {
      month: previous,
      label: monthLabel(previous, 'long'),
      reason:
        firstMonth !== null && month <= firstMonth
          ? `this Group has nothing before ${monthLabel(firstMonth, 'long')}`
          : null,
    },
    next: {
      month: next,
      label: monthLabel(next, 'long'),
      reason: month >= currentMonth ? `${monthName} is the current month` : null,
    },
  };
}

const money = (minor: number, currency: string) =>
  formatCurrency(toMajorAmount(minor, currency), currency);
const signedMoney = (minor: number, currency: string) =>
  `${minor > 0 ? '+' : minor < 0 ? '−' : ''}${money(Math.abs(minor), currency)}`;

const percentFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
/** "+2.6%", "−5.4%", "0.0%". */
export function signedPercent(percent: number): string {
  const text = percentFormat.format(Math.abs(percent));
  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${text}%`;
}

/** The earlier Months the average covers, as the read gives them: every Month but the last. */
function earlierMonthsOf(read: GroupInsightsRead): string[] {
  return read.months.slice(0, -1).map((entry) => entry.month);
}

/**
 * What the average is called: "6-month average", or, over one Month, that Month ("August").
 * Null when there is nothing earlier to average.
 */
export function averageName(read: GroupInsightsRead): string | null {
  if (!read.average) return null;
  const earlier = earlierMonthsOf(read);
  return read.average.monthCount === 1
    ? monthLabel(earlier[0], 'name')
    : `${read.average.monthCount}-month average`;
}

/** The average row's label in the table: "6-month average", or "Month before" over one Month. */
export function averageRowLabel(read: GroupInsightsRead): string | null {
  if (!read.average) return null;
  return read.average.monthCount === 1
    ? 'Month before'
    : `${read.average.monthCount}-month average`;
}

/** "April to September 2026", "October 2025 to September 2026" or "September 2026". */
export function monthsSpan(months: readonly string[]): string {
  const first = months[0];
  const last = months[months.length - 1];
  if (first === last) return monthLabel(last, 'long');
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${monthLabel(first, sameYear ? 'name' : 'long')} to ${monthLabel(last, 'long')}`;
}

export interface SpentChange {
  direction: ChangeDirection;
  /** "+2.6%", or the difference ("+₹18,420.00") when the average is zero. */
  headline: string;
  /** "vs 6-month average", "vs August". */
  against: string;
  /** The average, "₹17,947.50". */
  averageText: string;
}

export interface InsightsStats {
  /** "September 2026". */
  monthLong: string;
  currency: string;
  spent: { text: string; change: SpentChange | null; noComparison: string | null };
  share: { text: string; paidText: string };
  expenses: { count: number; recurringLine: string | null };
  biggest: { text: string; line: string } | null;
}

/** "You paid", "Priya Shah paid", "Sam Chen and Priya Shah paid", "Sam Chen and 2 others paid". */
export function payersLine(paidBy: readonly { id: string; name: string }[], userId: string) {
  const names = paidBy.map((payer) => (payer.id === userId ? 'You' : payer.name));
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} paid`;
  if (names.length === 2) return `${names[0]} and ${names[1]} paid`;
  return `${names[0]} and ${names.length - 1} others paid`;
}

/**
 * The four stat cards for the Month. The recurring line shows only while recurring Expenses
 * are on (one product-wide switch, #289): with a count, or "None" where the Group's Theme has
 * recurring Expenses at all.
 */
export function insightsStats(
  read: GroupInsightsRead,
  { userId, recurringTheme }: { userId: string; recurringTheme: boolean },
): InsightsStats {
  const { currency } = read;
  const current = read.months[read.months.length - 1];
  const name = averageName(read);
  const change: SpentChange | null =
    read.change && read.average && name
      ? {
          direction: read.change.direction,
          headline:
            read.change.changePercent === null
              ? signedMoney(read.change.differenceMinor, currency)
              : signedPercent(read.change.changePercent),
          against: `vs ${name}`,
          averageText: money(read.average.spentMinor, currency),
        }
      : null;
  const recurringCount = current.recurringCount;
  const recurringLine =
    !read.recurringExpenses || recurringCount === undefined
      ? null
      : recurringCount > 0
        ? `${recurringCount} added by recurring Expenses`
        : recurringTheme
          ? 'None added by recurring Expenses'
          : null;
  const biggest = read.biggestExpense;
  return {
    monthLong: monthLabel(read.month, 'long'),
    currency,
    spent: {
      text: money(current.spentMinor, currency),
      change,
      noComparison: change
        ? null
        : read.firstMonth !== null && read.month <= read.firstMonth
          ? 'The Group’s first month: nothing earlier to compare'
          : 'Nothing earlier to compare',
    },
    share: {
      text: money(current.yourShareMinor, currency),
      paidText: money(current.youPaidMinor, currency),
    },
    expenses: { count: current.expenseCount, recurringLine },
    biggest: biggest
      ? {
          text: money(biggest.amountMinor, currency),
          line: [biggest.description, payersLine(biggest.paidBy, userId)]
            .filter(Boolean)
            .join(' · '),
        }
      : null,
  };
}

export interface MonthlyRow {
  month: string;
  /** "Sep" */
  short: string;
  /** "September 2026" */
  long: string;
  /** The Month the tab is on, always the last row. */
  focus: boolean;
  /** Major units, for plotting. */
  spent: number;
  spentText: string;
  shareText: string;
  expenseCount: number;
}

export interface MonthlySpending {
  currency: string;
  /** Oldest first; the last is the Month. */
  rows: MonthlyRow[];
  /** "INR · April to September 2026 · whole Group" */
  subtitle: string;
  average: {
    /** Major units, for the line. */
    spent: number;
    spentText: string;
    shareText: string;
    /** "6-month average" or "August": the key under the chart on a phone. */
    name: string;
    /** "6-month avg" or "August": the label beside the line, as on the canvas. */
    shortName: string;
    /** "6-month average" or "Month before": the table's last row. */
    rowLabel: string;
  } | null;
  /** One sentence on the Month against the average. */
  explanation: string;
  /** The tooltip's line for the Month: "₹472.50 above the 6-month average". */
  focusComparison: string | null;
}

/** The monthly spending card's rows, average and sentence. */
export function monthlySpending(
  read: GroupInsightsRead,
  { currentMonth }: { currentMonth: string },
): MonthlySpending {
  const { currency } = read;
  const rows = read.months.map(
    (entry, index): MonthlyRow => ({
      month: entry.month,
      short: monthLabel(entry.month, 'short'),
      long: monthLabel(entry.month, 'long'),
      focus: index === read.months.length - 1,
      spent: toMajorAmount(entry.spentMinor, currency),
      spentText: money(entry.spentMinor, currency),
      shareText: money(entry.yourShareMinor, currency),
      expenseCount: entry.expenseCount,
    }),
  );
  const name = averageName(read);
  const rowLabel = averageRowLabel(read);
  const average =
    read.average && name && rowLabel
      ? {
          spent: toMajorAmount(read.average.spentMinor, currency),
          spentText: money(read.average.spentMinor, currency),
          shareText: money(read.average.yourShareMinor, currency),
          name,
          shortName: read.average.monthCount === 1 ? name : `${read.average.monthCount}-month avg`,
          rowLabel,
        }
      : null;

  const month = monthLabel(read.month, 'name');
  const against = name ? (read.average?.monthCount === 1 ? name : `the ${name}`) : null;
  let explanation: string;
  let focusComparison: string | null = null;
  if (!read.change || !against) {
    explanation =
      read.firstMonth !== null && read.month <= read.firstMonth
        ? `${month} is this Group’s first month, so there is nothing earlier to compare it with yet.`
        : `There is nothing before ${month} to compare it with.`;
  } else {
    const difference = money(Math.abs(read.change.differenceMinor), currency);
    const soFar = read.month === currentMonth ? 'So far, ' : '';
    if (read.change.direction === 'level') {
      explanation = `${soFar}${month} matches ${against}.`;
      focusComparison = `The same as ${against}`;
    } else {
      const side = read.change.direction === 'up' ? 'above' : 'below';
      explanation = `${soFar}${month} is ${difference} ${side} ${against}.`;
      focusComparison = `${difference} ${side} ${against}`;
    }
    // Asked for more Months than the Group has had: say why the average covers fewer.
    const counted = read.average?.monthCount ?? 0;
    if (read.firstMonth !== null && counted < read.compare)
      explanation += ` This Group started in ${monthLabel(read.firstMonth, 'long')}, so the average covers ${compareLabel(counted)}.`;
  }

  return {
    currency,
    rows,
    subtitle: `${currency} · ${monthsSpan(read.months.map((entry) => entry.month))} · whole Group`,
    average,
    explanation,
    focusComparison,
  };
}

/**
 * The note for a legacy Group with Expenses in other currencies: they are left out, never
 * converted. Null when there are none.
 */
export function otherCurrenciesNote(read: GroupInsightsRead): string | null {
  if (read.otherCurrencies.length === 0) return null;
  const count = read.otherCurrencies.reduce((sum, entry) => sum + entry.expenseCount, 0);
  const parts = read.otherCurrencies.map(
    (entry) =>
      `${entry.expenseCount} in ${entry.currency} (${money(entry.spentMinor, entry.currency)})`,
  );
  return `Only ${read.currency} Expenses are counted here. ${count === 1 ? 'One Expense' : `${count} Expenses`} in these months ${count === 1 ? 'is' : 'are'} in another currency and left out, never converted: ${parts.join(', ')}.`;
}
