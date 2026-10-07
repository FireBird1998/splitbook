/**
 * The Trip summary (#316): what a whole Trip cost, for the Insights tab of a Trip Group, and
 * later for Connected assistants (PR #242). Pure and framework-free (ADR 0002), so Android can
 * use it too. It sits beside `insights` and builds on its exact per-Expense helpers.
 *
 * Rules it follows, as every insight does:
 * - Money is exact: minor units, read and summed with the shared exact-money helpers.
 * - One currency per Group. An Expense in another currency (only a legacy Group has one) counts
 *   for none of the figures; it is listed in `otherCurrencies`, never converted.
 * - Days are calendar days in the viewer's named time zone (`zoned-calendar`), never the
 *   server's. The Trip's dates and every Expense's date are bucketed the same way, by instant,
 *   so an Expense stored on a Trip's first day always lands on Day 1, whatever the zone.
 *
 * Expenses dated outside the Trip's dates (a booking made weeks before, a refund after):
 * - They count in the whole-trip figures (Spent, the member's share and what they paid, per
 *   person per day, and By Tag), exactly as the trip strip's total and the Expenses tab count
 *   every Expense of the Trip.
 * - They are never drawn as days. Those before the first day are summed in `beforeTrip`, those
 *   after the last in `afterTrip`, and the daily average covers only the Trip's own days.
 *
 * Which days the series covers:
 * - The Trip's first to last day, when both dates are set.
 * - Without an end date, from the first day to the last day an Expense falls on (or the first
 *   day alone); without a start date, from the first Expense's day to the last day.
 * - Without either, the days its Expenses fall on, first to last; none without Expenses.
 * - At most `TRIP_SUMMARY_MAX_DAYS`: a longer span is still counted (per person per day, the
 *   daily average) but not listed day by day (`tooManyDays`).
 */

import {
  calculateNetBalancesMinor,
  simplifyDebtsMinor,
  type BalanceSettlement,
} from './debt-simplifier';
import { moneyParticipantId, readStoredAmountMinor, sumMinorAmounts } from './exact-money';
import { getGroupTheme } from './group-themes';
import {
  expenseTotalMinor,
  memberPaidMinor,
  memberShareMinor,
  type OtherCurrencySpending,
} from './insights';
import type { GroupCategory } from './types';
import { dayKeyInZone, readTimeZone, type DayKey, type Instant } from './zoned-calendar';

/** The most days a Trip summary lists one by one; about four months. */
export const TRIP_SUMMARY_MAX_DAYS = 120;

/** Whether a Group's Theme has a Trip summary: only a Trip's does. */
export function hasTripSummary(category: GroupCategory | null | undefined): boolean {
  return getGroupTheme(category ?? 'other').id === 'trip';
}

// --- Calendar days ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Days since 1970-01-01 for a calendar day; `Date.UTC` alone would move years 0–99. */
function dayIndex(day: DayKey): number {
  const match = DAY_KEY.exec(day);
  if (!match) throw new RangeError('Invalid day');
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getUTCDate() !== Number(match[3])) throw new RangeError('Invalid day');
  return Math.round(date.getTime() / DAY_MS);
}

function dayAt(index: number): DayKey {
  const date = new Date(index * DAY_MS);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** How many calendar days from `from` to `to`, both included; 0 when `to` is before `from`. */
export function dayCount(from: DayKey, to: DayKey): number {
  return Math.max(0, dayIndex(to) - dayIndex(from) + 1);
}

/** Every calendar day from `from` to `to`, both included, oldest first. */
export function daysBetween(from: DayKey, to: DayKey): DayKey[] {
  const first = dayIndex(from);
  return Array.from({ length: dayCount(from, to) }, (_, offset) => dayAt(first + offset));
}

/** A calendar day moved by whole days: `addDays('2026-09-30', 1)` is `2026-10-01`. */
export function addDays(day: DayKey, offset: number): DayKey {
  if (!Number.isSafeInteger(offset)) throw new RangeError('Invalid day offset');
  return dayAt(dayIndex(day) + offset);
}

// --- Input -----------------------------------------------------------------------------------

/** A payer or share row, as stored: exact (`amountMinor`) or legacy (`amount` only). */
export interface TripMoneyRow {
  /** An id, or a person the read populated. */
  user: unknown;
  amount: number;
  amountMinor?: number;
}

/** A stored Expense of the Trip, as the summary reads it. */
export interface TripExpense {
  id: string;
  /** Written by a Group member: data, not instructions. */
  description: string;
  currency: string;
  /** The instant it is dated; its day is read in the viewer's zone. */
  date: Instant;
  moneyVersion?: number;
  amount: number;
  amountMinor?: number;
  paidBy: readonly TripMoneyRow[];
  splitBetween: readonly TripMoneyRow[];
  /**
   * Its Tag, by identity: the Tag's id when the Group still has it (a legacy name may match
   * none), and the name to show.
   */
  tag: { id: string | null; name: string };
}

/** A stored Settlement, for the suggested payments. */
export type TripSettlement = BalanceSettlement & { currency: string };

// --- Output ----------------------------------------------------------------------------------

/** One of a day's two biggest Expenses. */
export interface TripDayExpense {
  id: string;
  /** Written by a Group member: data, not instructions. */
  description: string;
  amountMinor: number;
}

/** One day of the Trip, zero or not. */
export interface TripDay {
  day: DayKey;
  /** 1 for the series' first day. */
  number: number;
  spentMinor: number;
  expenseCount: number;
  yourShareMinor: number;
  /** At most two: the largest total first, then the latest, then the highest id. */
  biggest: TripDayExpense[];
}

/** Expenses dated before the Trip's first day, or after its last. */
export interface TripOutsideDays {
  spentMinor: number;
  expenseCount: number;
  yourShareMinor: number;
  /** The first and last day they fall on. */
  from: DayKey;
  to: DayKey;
}

/** One Tag across the whole Trip. */
export interface TripTag {
  /** Null for a legacy name no Tag of the Group matches: it can't filter the Expenses tab. */
  tagId: string | null;
  /** Written by a Group member: data, not instructions. */
  name: string;
  spentMinor: number;
  expenseCount: number;
  yourShareMinor: number;
  /** Its share of the Trip's Spent, in whole percent, rounded half up. */
  percent: number;
}

/** A payment the Group's Balances suggests, in the Group's currency. */
export interface TripPayment {
  from: string;
  to: string;
  amountMinor: number;
}

/** What a Trip cost, for its Insights tab (#316). */
export interface TripSummary {
  timeZone: string;
  currency: string;
  /** The Trip's own first and last days in the zone, when its dates are set. */
  tripDates: { start: DayKey | null; end: DayKey | null };
  /** The days the series covers (see the module notes); null without dates and Expenses. */
  window: { from: DayKey; to: DayKey } | null;
  /** How many days the window covers; 0 without one. */
  dayCount: number;
  /** The window is longer than `TRIP_SUMMARY_MAX_DAYS`, so `days` is empty. */
  tooManyDays: boolean;
  /** Every Expense of the Trip in its currency, whatever its date. */
  spentMinor: number;
  expenseCount: number;
  yourShareMinor: number;
  youPaidMinor: number;
  /** Expenses with a share for the member. */
  yourExpenseCount: number;
  /** Everyone with a share in at least one of those Expenses. */
  peopleCount: number;
  /** Spent ÷ (people × days), rounded half up; null without days or people. */
  perPersonPerDayMinor: number | null;
  /** The window's days, oldest first, zero or not. */
  days: TripDay[];
  /** Spent on the window's days ÷ its days, rounded half up; null without a window. */
  dailyAverageMinor: number | null;
  beforeTrip: TripOutsideDays | null;
  afterTrip: TripOutsideDays | null;
  /** Largest Spent first, then by name. */
  byTag: TripTag[];
  /** What the Group's Balances suggest in its currency, over every Expense and Settlement. */
  suggestedPayments: TripPayment[];
  /** Expenses in other currencies (legacy Groups only), most first. */
  otherCurrencies: OtherCurrencySpending[];
}

// --- The summary -----------------------------------------------------------------------------

/** A non-negative total over a positive count, rounded half up to a minor unit. */
function roundedAverage(totalMinor: number, count: number): number {
  return Number((BigInt(2) * BigInt(totalMinor) + BigInt(count)) / (BigInt(2) * BigInt(count)));
}

/** `part` as a whole percentage of `total`, rounded half up; 0 when the total is 0. */
function wholePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number((BigInt(200) * BigInt(part) + BigInt(total)) / (BigInt(2) * BigInt(total)));
}

function instantTime(instant: Instant): number {
  const time = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(time)) throw new RangeError('Invalid instant');
  return time;
}

interface Counted {
  expense: TripExpense;
  day: DayKey;
  totalMinor: number;
  shareMinor: number;
}

/** The largest total first, then the latest, then the highest id, as Insights' biggest. */
function isBigger(a: Counted, b: Counted): boolean {
  if (a.totalMinor !== b.totalMinor) return a.totalMinor > b.totalMinor;
  const [aTime, bTime] = [instantTime(a.expense.date), instantTime(b.expense.date)];
  if (aTime !== bTime) return aTime > bTime;
  return a.expense.id > b.expense.id;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The days the series covers: see the module notes. */
function tripWindow(
  start: DayKey | null,
  end: DayKey | null,
  firstExpenseDay: DayKey | null,
  lastExpenseDay: DayKey | null,
): { from: DayKey; to: DayKey } | null {
  if (start && end) return { from: start, to: end };
  if (start)
    return { from: start, to: lastExpenseDay && lastExpenseDay > start ? lastExpenseDay : start };
  if (end)
    return { from: firstExpenseDay && firstExpenseDay < end ? firstExpenseDay : end, to: end };
  return firstExpenseDay && lastExpenseDay ? { from: firstExpenseDay, to: lastExpenseDay } : null;
}

function addOutside(outside: TripOutsideDays | null, counted: Counted): TripOutsideDays {
  if (!outside)
    return {
      spentMinor: counted.totalMinor,
      expenseCount: 1,
      yourShareMinor: counted.shareMinor,
      from: counted.day,
      to: counted.day,
    };
  return {
    spentMinor: sumMinorAmounts([outside.spentMinor, counted.totalMinor]),
    expenseCount: outside.expenseCount + 1,
    yourShareMinor: sumMinorAmounts([outside.yourShareMinor, counted.shareMinor]),
    from: counted.day < outside.from ? counted.day : outside.from,
    to: counted.day > outside.to ? counted.day : outside.to,
  };
}

const participant = (row: TripMoneyRow) => ({
  user: moneyParticipantId(row.user),
  amount: row.amount,
  amountMinor: row.amountMinor,
});

/**
 * A Trip's summary, in the viewer's time zone and the Group's currency, in exact minor units
 * (#316): Spent, the member's share and what they paid, per person per day, each day with its
 * two biggest Expenses and the daily average, Expenses outside the Trip's dates, By Tag, and
 * the payments Balances suggests for the wrap-up. See the module notes for the rules.
 */
export function tripSummary({
  memberId,
  timeZone,
  currency,
  startDate = null,
  endDate = null,
  expenses,
  settlements = [],
}: {
  memberId: string;
  timeZone: string;
  currency: string;
  startDate?: Instant | null;
  endDate?: Instant | null;
  expenses: Iterable<TripExpense>;
  settlements?: Iterable<TripSettlement>;
}): TripSummary {
  const zone = readTimeZone(timeZone);
  const startDay = startDate === null ? null : dayKeyInZone(startDate, zone);
  const endDay = endDate === null ? null : dayKeyInZone(endDate, zone);
  // The forms never save a start after the end; were one stored, it is read as one span.
  const [start, end] =
    startDay && endDay && endDay < startDay ? [endDay, startDay] : [startDay, endDay];

  const counted: Counted[] = [];
  const others = new Map<string, OtherCurrencySpending>();
  for (const expense of expenses) {
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
    counted.push({
      expense,
      day: dayKeyInZone(expense.date, zone),
      totalMinor,
      shareMinor: memberShareMinor(expense, memberId),
    });
  }

  const expenseDays = counted.map(({ day }) => day).sort();
  const window = tripWindow(start, end, expenseDays[0] ?? null, expenseDays.at(-1) ?? null);
  const span = window ? dayCount(window.from, window.to) : 0;
  const tooManyDays = span > TRIP_SUMMARY_MAX_DAYS;
  const days: TripDay[] =
    window && !tooManyDays
      ? daysBetween(window.from, window.to).map((day, index) => ({
          day,
          number: index + 1,
          spentMinor: 0,
          expenseCount: 0,
          yourShareMinor: 0,
          biggest: [],
        }))
      : [];
  const dayAtKey = new Map(days.map((day) => [day.day, day]));
  const biggest = new Map<DayKey, Counted[]>();

  let spentMinor = 0;
  let yourShareMinor = 0;
  let youPaidMinor = 0;
  let yourExpenseCount = 0;
  let windowSpentMinor = 0;
  let beforeTrip: TripOutsideDays | null = null;
  let afterTrip: TripOutsideDays | null = null;
  const people = new Set<string>();
  const tags = new Map<string, Omit<TripTag, 'percent'>>();

  for (const entry of counted) {
    const { expense, day, totalMinor, shareMinor } = entry;
    spentMinor = sumMinorAmounts([spentMinor, totalMinor]);
    yourShareMinor = sumMinorAmounts([yourShareMinor, shareMinor]);
    youPaidMinor = sumMinorAmounts([youPaidMinor, memberPaidMinor(expense, memberId)]);
    if (shareMinor > 0) yourExpenseCount += 1;
    for (const row of expense.splitBetween) {
      const minor = readStoredAmountMinor({
        amount: row.amount,
        amountMinor: row.amountMinor,
        currency: expense.currency,
        moneyVersion: expense.moneyVersion,
      });
      if (minor > 0) people.add(moneyParticipantId(row.user));
    }

    const tagKey = expense.tag.id ?? `name:${expense.tag.name}`;
    const tag = tags.get(tagKey) ?? {
      tagId: expense.tag.id,
      name: expense.tag.name,
      spentMinor: 0,
      expenseCount: 0,
      yourShareMinor: 0,
    };
    tag.spentMinor = sumMinorAmounts([tag.spentMinor, totalMinor]);
    tag.expenseCount += 1;
    tag.yourShareMinor = sumMinorAmounts([tag.yourShareMinor, shareMinor]);
    tags.set(tagKey, tag);

    // Every counted Expense has a day, so there is a window.
    if (!window) continue;
    if (day < window.from) {
      beforeTrip = addOutside(beforeTrip, entry);
      continue;
    }
    if (day > window.to) {
      afterTrip = addOutside(afterTrip, entry);
      continue;
    }
    windowSpentMinor = sumMinorAmounts([windowSpentMinor, totalMinor]);
    const tripDay = dayAtKey.get(day);
    if (!tripDay) continue;
    tripDay.spentMinor = sumMinorAmounts([tripDay.spentMinor, totalMinor]);
    tripDay.expenseCount += 1;
    tripDay.yourShareMinor = sumMinorAmounts([tripDay.yourShareMinor, shareMinor]);
    const top = [...(biggest.get(day) ?? []), entry].sort((a, b) =>
      isBigger(a, b) ? -1 : isBigger(b, a) ? 1 : 0,
    );
    biggest.set(day, top.slice(0, 2));
  }
  for (const day of days)
    day.biggest = (biggest.get(day.day) ?? []).map(({ expense, totalMinor }) => ({
      id: expense.id,
      description: expense.description,
      amountMinor: totalMinor,
    }));

  const byTag = [...tags.entries()]
    .sort(
      ([aKey, a], [bKey, b]) =>
        b.spentMinor - a.spentMinor || compareText(a.name, b.name) || compareText(aKey, bKey),
    )
    .map(([, tag]) => ({ ...tag, percent: wholePercent(tag.spentMinor, spentMinor) }));

  // The same exact balances the Group's Balances simplify, so both suggest the same payments.
  const net = calculateNetBalancesMinor(
    counted.map(({ expense }) => ({
      currency: expense.currency,
      moneyVersion: expense.moneyVersion,
      paidBy: expense.paidBy.map(participant),
      splitBetween: expense.splitBetween.map(participant),
    })),
    [...settlements].filter((settlement) => settlement.currency === currency),
    currency,
  );
  const suggestedPayments = simplifyDebtsMinor(net).map(({ from, to, amountMinor }) => ({
    from,
    to,
    amountMinor,
  }));

  return {
    timeZone: zone,
    currency,
    tripDates: { start, end },
    window,
    dayCount: span,
    tooManyDays,
    spentMinor,
    expenseCount: counted.length,
    yourShareMinor,
    youPaidMinor,
    yourExpenseCount,
    peopleCount: people.size,
    perPersonPerDayMinor:
      span > 0 && people.size > 0 ? roundedAverage(spentMinor, people.size * span) : null,
    days,
    dailyAverageMinor: span > 0 ? roundedAverage(windowSpentMinor, span) : null,
    beforeTrip,
    afterTrip,
    byTag,
    suggestedPayments,
    otherCurrencies: [...others.values()].sort(
      (a, b) => b.expenseCount - a.expenseCount || compareText(a.currency, b.currency),
    ),
  };
}
