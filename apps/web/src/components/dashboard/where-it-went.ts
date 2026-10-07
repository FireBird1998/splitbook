/**
 * What Home's "Where it went" card shows for one currency (#308): the member's share of this
 * Month by Category across their Groups, from the spending read's Month in detail. Categories
 * are global, so they add up across Groups; Tags belong to one Group and are never merged.
 * Pure, so the bars and the table show the same numbers.
 */
import { getCategory } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { SpendingThisMonthRead } from '@splitbook/shared/user-spending-read';
import { monthLabel } from './spending-chart';

export interface CategoryRow {
  category: string;
  /** "Food & Drink" */
  label: string;
  /** In the currency's major units. */
  amount: number;
  text: string;
  expenseCount: number;
  /** The bar's length, as a percentage of the largest Category's. */
  width: number;
}

export interface WhereItWentModel {
  currency: string;
  /** Every currency with spending this Month, in the read's order: the switch's options. */
  currencies: string[];
  /** Largest first. */
  rows: CategoryRow[];
  total: { amount: number; text: string; expenseCount: number };
}

/** "October": the Month the card covers. */
export function thisMonthName(thisMonth: Pick<SpendingThisMonthRead, 'month'>): string {
  return monthLabel(thisMonth.month, 'name');
}

/** A Category's name; one the app doesn't know is Other, as the read counts it. */
export function categoryLabel(category: string): string {
  return getCategory(category)?.label ?? getCategory('other')!.label;
}

const money = (minor: number, currency: string) => {
  const amount = toMajorAmount(minor, currency);
  return { amount, text: formatCurrency(amount, currency) };
};

/** The smallest bar still drawn, so a tiny share never disappears. */
const MIN_WIDTH = 1;

/**
 * The card's figures for one currency: the one asked for when the member has spending in it,
 * otherwise the read's first. Null when the member has no share of anything this Month.
 */
export function whereItWentModel(
  thisMonth: SpendingThisMonthRead,
  currency?: string,
): WhereItWentModel | null {
  const series =
    thisMonth.byCategory.find((entry) => entry.currency === currency) ?? thisMonth.byCategory[0];
  if (!series || series.categories.length === 0) return null;
  const largest = Math.max(...series.categories.map((part) => part.shareMinor));
  return {
    currency: series.currency,
    currencies: thisMonth.byCategory.map((entry) => entry.currency),
    rows: series.categories.map((part) => ({
      category: part.category,
      label: categoryLabel(part.category),
      ...money(part.shareMinor, series.currency),
      expenseCount: part.expenseCount,
      width: largest > 0 ? Math.max(MIN_WIDTH, (part.shareMinor / largest) * 100) : MIN_WIDTH,
    })),
    total: { ...money(series.totalMinor, series.currency), expenseCount: series.expenseCount },
  };
}
