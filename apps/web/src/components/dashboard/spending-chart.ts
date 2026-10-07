/**
 * What Home's "Your share of spending" card shows for one currency (#307): the six Months as
 * rows, each Group's part, and the one-line explanation, from the spending read. Pure, so the
 * chart, its tooltip and the table all show the same numbers.
 */
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { spendingTrend, type SpendingTrend } from '@splitbook/shared/insights';
import type { UserSpendingRead } from '@splitbook/shared/user-spending-read';

export interface SpendingPart {
  groupId: string;
  name: string;
  /** In the currency's major units, for plotting. */
  amount: number;
  text: string;
}

export interface SpendingMonthRow {
  month: string;
  /** `Sep` */
  short: string;
  /** `September 2026` */
  long: string;
  current: boolean;
  amount: number;
  text: string;
  /** Largest first; only Groups with a part this Month. */
  parts: SpendingPart[];
}

export interface SpendingChartModel {
  currency: string;
  /** Every currency with spending, in the read's order: the switch's options. */
  currencies: string[];
  /** Oldest first; the last is the current Month. */
  rows: SpendingMonthRow[];
  /** The Groups with a part in this currency, largest total first: the table's columns. */
  groups: { groupId: string; name: string }[];
  /** One sentence on the current Month, or null when there is nothing to compare. */
  explanation: string | null;
}

const monthDate = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return Date.UTC(year, number - 1, 15);
};
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const longMonth = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

/** `Sep`, `September 2026` or `September` for a `YYYY-MM` Month. */
export function monthLabel(month: string, form: 'short' | 'long' | 'name'): string {
  const format = form === 'short' ? shortMonth : form === 'long' ? longMonth : monthName;
  return format.format(monthDate(month));
}

/** An axis label such as `₹10K` or `€750`. */
export function compactMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * The value axis, as on the canvas: four even steps from zero on a round scale, with about 15%
 * room above the tallest column so the figure over the current Month stays inside the plot.
 */
export function valueAxis(highest: number): { max: number; ticks: number[] } {
  const target = (Math.max(highest, 0) * 1.15) / 4;
  if (!(target > 0)) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = NICE_STEPS.map((factor) => factor * magnitude).find((value) => value >= target)!;
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map((index) => index * step) };
}

const money = (minor: number, currency: string) => {
  const amount = toMajorAmount(minor, currency);
  return { amount, text: formatCurrency(amount, currency) };
};

/** The sentence under the chart: how the current Month compares with the Months before it. */
export function explainTrend(
  trend: SpendingTrend | null,
  {
    currency,
    groupName,
    earlierMonths,
  }: {
    currency: string;
    groupName: (groupId: string) => string;
    earlierMonths: number;
  },
): string | null {
  if (!trend) return null;
  const month = monthLabel(trend.month, 'name');
  if (trend.kind === 'none') return `Nothing in ${month} yet.`;
  const total = money(trend.totalMinor, currency).text;
  if (trend.kind === 'up')
    return `${month} is up because of ${groupName(trend.groupId)}: ${money(trend.groupShareMinor, currency).text} of your ${total}.`;
  const average = money(trend.averageMinor, currency).text;
  const before = `the ${earlierMonths === 1 ? 'month' : `${earlierMonths} months`} before`;
  return trend.kind === 'level'
    ? `${month} matches your average of ${average} for ${before}.`
    : `So far, ${month} is below your average of ${average} for ${before}.`;
}

/**
 * The card's figures for one currency: the one asked for when the member has spending in it,
 * otherwise the read's first. Null when the member has no spending in the window.
 */
export function spendingChartModel(
  read: UserSpendingRead,
  currency?: string,
): SpendingChartModel | null {
  const series = read.currencies.find((entry) => entry.currency === currency) ?? read.currencies[0];
  if (!series) return null;
  const names = new Map(read.groups.map((group) => [group.groupId, group.name]));
  const groupName = (groupId: string) => names.get(groupId) ?? 'Another Group';
  const byMonth = new Map(series.months.map((entry) => [entry.month, entry]));
  const current = read.months[read.months.length - 1];

  const totals = new Map<string, number>();
  const rows = read.months.map((month): SpendingMonthRow => {
    const entry = byMonth.get(month);
    const parts = (entry?.byGroup ?? []).map((part) => {
      totals.set(part.groupId, (totals.get(part.groupId) ?? 0) + part.shareMinor);
      return {
        groupId: part.groupId,
        name: groupName(part.groupId),
        ...money(part.shareMinor, series.currency),
      };
    });
    return {
      month,
      short: monthLabel(month, 'short'),
      long: monthLabel(month, 'long'),
      current: month === current,
      ...money(entry?.shareMinor ?? 0, series.currency),
      parts,
    };
  });

  const trend = spendingTrend({
    months: read.months.map((month) => {
      const entry = byMonth.get(month);
      return { month, shareMinor: entry?.shareMinor ?? 0, byGroup: entry?.byGroup ?? [] };
    }),
  });

  return {
    currency: series.currency,
    currencies: read.currencies.map((entry) => entry.currency),
    rows,
    groups: [...totals]
      .sort(
        ([a, aTotal], [b, bTotal]) => bTotal - aTotal || groupName(a).localeCompare(groupName(b)),
      )
      .map(([groupId]) => ({ groupId, name: groupName(groupId) })),
    explanation: explainTrend(trend, {
      currency: series.currency,
      groupName,
      earlierMonths: read.months.length - 1,
    }),
  };
}
