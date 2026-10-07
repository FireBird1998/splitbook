/**
 * What a Trip's Insights tab shows (#316), from the Trip summary read: the whole-trip figures,
 * the day-by-day chart and its table, By Tag, and the wrap-up's suggested payments. Pure, so the
 * cards, the chart, its tooltip and the table all say the same thing.
 *
 * Days are the viewer's own, in their time zone; amounts stay in the Trip's one currency, never
 * converted. Expenses dated outside the Trip's dates count in the whole trip and By Tag, and are
 * named under the chart, never drawn as days.
 */
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type {
  TripSummaryDayRead,
  TripSummaryRead,
  TripSummaryTagRead,
} from '@splitbook/shared/trip-summary-read';
import { groupTabHref } from '@/components/groups/group-tabs';
import { writeExpenseListQuery } from '@/components/expenses/expense-list-query';
import { recordPaymentHref } from '@/components/settlements/record-payment';
import { tripDayLabel, tripDayName, tripDayShort } from './trip-days';

export const money = (minor: number, currency: string) =>
  formatCurrency(toMajorAmount(minor, currency), currency);

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const expenses = (count: number) => plural(count, 'Expense');

/** The tab's state: the read for this time zone, still loading, failed, or a Trip without Expenses. */
export type TripCardState = 'ready' | 'loading' | 'failed' | 'empty';

export function tripCardState(read: TripSummaryRead | undefined, failed: boolean): TripCardState {
  if (read) return read.hasExpenses ? 'ready' : 'empty';
  return failed ? 'failed' : 'loading';
}

// --- The whole trip --------------------------------------------------------------------------

export interface TripFigures {
  /** "Whole trip · INR". */
  heading: string;
  spent: { text: string; line: string };
  share: { text: string; line: string };
  paid: { text: string; line: string; tone: 'positive' | 'neutral' };
  perPersonPerDay: { text: string | null; line: string };
}

export function tripFigures(read: TripSummaryRead): TripFigures {
  const { currency } = read;
  const days = read.dayCount > 0 ? ` over ${plural(read.dayCount, 'day')}` : '';
  const difference = read.youPaidMinor - read.yourShareMinor;
  return {
    heading: `Whole trip · ${currency}`,
    spent: {
      text: money(read.spentMinor, currency),
      line: `${expenses(read.expenseCount)}${days}`,
    },
    share: {
      text: money(read.yourShareMinor, currency),
      line:
        read.expenseCount === 1
          ? read.yourExpenseCount === 1
            ? 'In its one Expense'
            : 'Not in its one Expense'
          : read.yourExpenseCount === read.expenseCount
            ? `In all ${read.expenseCount} of its Expenses`
            : `In ${read.yourExpenseCount} of its ${read.expenseCount} Expenses`,
    },
    paid: {
      text: money(read.youPaidMinor, currency),
      line:
        difference > 0
          ? `${money(difference, currency)} more than your share`
          : difference < 0
            ? `${money(-difference, currency)} less than your share`
            : 'The same as your share',
      tone: difference > 0 ? 'positive' : 'neutral',
    },
    perPersonPerDay: {
      text: read.perPersonPerDayMinor === null ? null : money(read.perPersonPerDayMinor, currency),
      line:
        read.perPersonPerDayMinor === null
          ? 'Needs a day and someone sharing'
          : `${plural(read.peopleCount, 'person', 'people')} · ${plural(read.dayCount, 'day')}`,
    },
  };
}

/** The note for a legacy Trip with Expenses in other currencies: left out, never converted. */
export function otherCurrenciesNote(read: TripSummaryRead): string | null {
  if (read.otherCurrencies.length === 0) return null;
  const count = read.otherCurrencies.reduce((sum, entry) => sum + entry.expenseCount, 0);
  const parts = read.otherCurrencies.map(
    (entry) =>
      `${entry.expenseCount} in ${entry.currency} (${money(entry.spentMinor, entry.currency)})`,
  );
  return `Only ${read.currency} Expenses are counted here. ${count === 1 ? 'One Expense is' : `${count} Expenses are`} in another currency and left out, never converted: ${parts.join(', ')}.`;
}

// --- Day by day ------------------------------------------------------------------------------

export interface TripDayRow {
  day: string;
  /** "Day 2 · Fri 18 Sep" (or "Fri 18 Sep" without a first day). */
  name: string;
  /** "Fri 18", or "18" when there are too many days for names. */
  axis: string;
  /** Major units, for plotting. */
  spent: number;
  spentText: string;
  shareText: string;
  expenseCount: number;
  /** The day's two biggest Expenses. */
  biggest: { description: string; amountText: string }[];
  /** The day that cost the most, drawn in the full series colour. */
  focus: boolean;
}

export interface TripOutsideRow {
  /** "Before the trip" or "After the trip". */
  name: string;
  /** "Sun 30 Aug", or "Sun 30 Aug to Tue 1 Sep". */
  span: string;
  expenseCount: number;
  spentText: string;
  shareText: string;
}

export interface TripDayChart {
  currency: string;
  /** "INR spent each day · Thu 17 Sep to Sun 20 Sep". */
  subtitle: string;
  rows: TripDayRow[];
  average: { spent: number; text: string } | null;
  outside: TripOutsideRow[];
  whole: { expenseCount: number; spentText: string; shareText: string };
  /** The biggest day, or why there are no days to draw. */
  explanation: string;
  /** Expenses dated outside the Trip's days: counted, but not drawn. */
  outsideNote: string | null;
}

/** More days than this and the columns are labelled with the date alone. */
const NAMED_AXIS_DAYS = 8;

function span(from: string, to: string, thisYear: number) {
  return from === to
    ? tripDayLabel(from, thisYear)
    : `${tripDayLabel(from, thisYear)} to ${tripDayLabel(to, thisYear)}`;
}

/** The day that cost the most; the earliest of equals. Null when no day has spending. */
function biggestDay(days: readonly TripSummaryDayRead[]): TripSummaryDayRead | null {
  let biggest: TripSummaryDayRead | null = null;
  for (const day of days) if (day.spentMinor > (biggest?.spentMinor ?? 0)) biggest = day;
  return biggest;
}

export function tripDayChart(
  read: TripSummaryRead,
  { thisYear }: { thisYear: number },
): TripDayChart {
  const { currency } = read;
  const dates = { start: read.tripDates.start, end: read.tripDates.end, thisYear };
  const focus = biggestDay(read.days);
  const rows = read.days.map(
    (day): TripDayRow => ({
      day: day.day,
      name: tripDayName(day.day, dates),
      axis:
        read.days.length > NAMED_AXIS_DAYS
          ? day.day.slice(8).replace(/^0/, '')
          : tripDayShort(day.day),
      spent: toMajorAmount(day.spentMinor, currency),
      spentText: money(day.spentMinor, currency),
      shareText: money(day.yourShareMinor, currency),
      expenseCount: day.expenseCount,
      biggest: day.biggest.map((expense) => ({
        description: expense.description,
        amountText: money(expense.amountMinor, currency),
      })),
      focus: day === focus,
    }),
  );
  const outside: TripOutsideRow[] = [];
  if (read.beforeTrip)
    outside.push({
      name: 'Before the trip',
      span: span(read.beforeTrip.from, read.beforeTrip.to, thisYear),
      expenseCount: read.beforeTrip.expenseCount,
      spentText: money(read.beforeTrip.spentMinor, currency),
      shareText: money(read.beforeTrip.yourShareMinor, currency),
    });
  if (read.afterTrip)
    outside.push({
      name: 'After the trip',
      span: span(read.afterTrip.from, read.afterTrip.to, thisYear),
      expenseCount: read.afterTrip.expenseCount,
      spentText: money(read.afterTrip.spentMinor, currency),
      shareText: money(read.afterTrip.yourShareMinor, currency),
    });

  let explanation: string;
  if (read.tooManyDays && read.window)
    explanation = `This trip runs over ${plural(read.dayCount, 'day')}, too many to draw one by one. It spent ${money(read.dailyAverageMinor ?? 0, currency)} a day on average.`;
  else if (rows.length === 0) explanation = `Nothing in ${currency} to draw day by day yet.`;
  else if (!focus) explanation = 'Nothing has been spent on these days yet.';
  else {
    const day = tripDayLabel(focus.day, thisYear);
    const [top] = focus.biggest;
    const topText = money(top.amountMinor, currency);
    explanation =
      focus.expenseCount === 1
        ? `${day} was the biggest day: ${top.description}, ${topText}.`
        : `${day} was the biggest day: ${top.description} was ${topText} of its ${money(focus.spentMinor, currency)}.`;
  }

  const outsideParts = outside.map(
    (row) =>
      `${row.spentText} ${row.name === 'Before the trip' ? 'before' : 'after'} it (${expenses(row.expenseCount)})`,
  );
  return {
    currency,
    subtitle: read.window
      ? `${currency} spent each day · ${span(read.window.from, read.window.to, thisYear)}`
      : `${currency} spent each day`,
    rows,
    average:
      read.dailyAverageMinor === null || rows.length === 0
        ? null
        : {
            spent: toMajorAmount(read.dailyAverageMinor, currency),
            text: money(read.dailyAverageMinor, currency),
          },
    outside,
    whole: {
      expenseCount: read.expenseCount,
      spentText: money(read.spentMinor, currency),
      shareText: money(read.yourShareMinor, currency),
    },
    explanation,
    outsideNote:
      outsideParts.length === 0
        ? null
        : `Expenses dated outside the trip’s days count in the whole trip, but aren’t drawn here: ${outsideParts.join(' and ')}.`,
  };
}

// --- By Tag ----------------------------------------------------------------------------------

export interface TripTagRow {
  key: string;
  name: string;
  spentText: string;
  /** "34%". */
  percentText: string;
  /** "3 Expenses". */
  countText: string;
  /** The bar's length against the biggest Tag's, 0–100. */
  width: number;
  /** The Expenses tab filtered by this Tag; null for a legacy name that matches no Tag. */
  href: string | null;
  /** What a screen reader hears for the row. */
  label: string;
}

/** The Expenses tab, filtered by a Tag with #310's address filter. */
export function tagExpensesHref(groupId: string, tagId: string): string {
  return groupTabHref(groupId, 'expenses', writeExpenseListQuery('', { tag: tagId }));
}

export function tripTags(read: TripSummaryRead, groupId: string): TripTagRow[] {
  const largest = Math.max(0, ...read.byTag.map((tag) => tag.spentMinor));
  return read.byTag.map((tag: TripSummaryTagRead, index) => {
    const spentText = money(tag.spentMinor, read.currency);
    const percentText = `${tag.percent}%`;
    const countText = expenses(tag.expenseCount);
    return {
      key: tag.tagId ?? `name-${index}`,
      name: tag.name,
      spentText,
      percentText,
      countText,
      width: largest > 0 ? Math.round((tag.spentMinor / largest) * 1000) / 10 : 0,
      href: tag.tagId ? tagExpensesHref(groupId, tag.tagId) : null,
      label: `${tag.name}: ${spentText}, ${percentText} of ${read.currency} spend, ${countText}${tag.tagId ? '. Show these Expenses' : ''}`,
    };
  });
}

// --- The wrap-up -----------------------------------------------------------------------------

export interface WrapUpRow {
  key: string;
  /** Payer first, as the canvas draws them. */
  payer: string;
  payee: string;
  /** "Priya Shah pays you", "You pay Sam Chen", "Priya Shah pays Sam Chen". */
  title: string;
  amountText: string;
  /**
   * Record payment, on Balances with the pair filled in: only where the viewer pays or is paid
   * (the parties-only rule). Null for a payment between two other people.
   */
  record: { href: string; label: string } | null;
  /** For a payment between two others: who can record it. */
  note: string | null;
}

export interface WrapUp {
  subtitle: string;
  rows: WrapUpRow[];
  /** A legacy Trip's other currencies settle on Balances. */
  otherCurrencies: string | null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function wrapUp(
  read: TripSummaryRead,
  { groupId, userId, today }: { groupId: string; userId: string; today: string },
): WrapUp {
  const { currency } = read;
  const end = read.tripDates.end;
  const thisYear = Number(today.slice(0, 4));
  const subtitle =
    end && today > end
      ? `The trip ended on ${tripDayLabel(end, thisYear)}. Settle while it’s fresh.`
      : end
        ? `The trip runs until ${tripDayLabel(end, thisYear)}. Here’s who would pay whom today.`
        : 'Who pays whom to settle the trip.';
  const rows = read.suggestedPayments.map((payment, index): WrapUpRow => {
    const amountText = money(payment.amountMinor, currency);
    const pays = payment.from.id === userId;
    const paid = payment.to.id === userId;
    const title = pays
      ? `You pay ${payment.to.name}`
      : paid
        ? `${payment.from.name} pays you`
        : `${payment.from.name} pays ${payment.to.name}`;
    return {
      key: `${payment.from.id}-${payment.to.id}-${index}`,
      payer: payment.from.name,
      payee: payment.to.name,
      title,
      amountText,
      record:
        pays || paid
          ? {
              href: recordPaymentHref(groupId, {
                direction: pays ? 'pay' : 'receive',
                counterpartyId: pays ? payment.to.id : payment.from.id,
              }),
              label: `Record payment: ${title}, ${amountText}`,
            }
          : null,
      note:
        pays || paid
          ? null
          : `${firstName(payment.from.name)} or ${firstName(payment.to.name)} records it`,
    };
  });
  return {
    subtitle,
    rows,
    otherCurrencies:
      read.otherCurrencies.length > 0
        ? `These are the ${currency} payments. Balances in other currencies settle on the Balances tab.`
        : null,
  };
}
