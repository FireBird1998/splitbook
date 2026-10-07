/**
 * What the Insights tab's Month detail cards show (#315), from the Group insights read: By Tag,
 * Who paid this month and Recurring Expenses. Pure, so each card's bars, its table and its
 * words all say the same thing. Each card's data is decoded on its own
 * (`@splitbook/shared/group-insights-read`), so one malformed field fails only its own card.
 *
 * Wording: "Paid" and "Share", never "fronted"; "recurring Expenses", never "bills".
 */
import { format } from 'date-fns';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type {
  GroupInsightsByTagRead,
  GroupInsightsRead,
  GroupInsightsRecurringRead,
  GroupInsightsWhoPaidRead,
} from '@splitbook/shared/group-insights-read';
import type { ChangeDirection } from '@splitbook/shared/insights';
import { monthLabel } from '@/components/dashboard/spending-chart';
import { averageName, monthsSpan, signedPercent } from './group-insights';

/** A card's state on the tab: the read's, or `failed` when the card's own data is malformed. */
export type InsightsCardState = 'ready' | 'loading' | 'failed' | 'empty';

const money = (minor: number, currency: string) =>
  formatCurrency(toMajorAmount(minor, currency), currency);
const signedMoney = (minor: number, currency: string) =>
  `${minor > 0 ? '+' : minor < 0 ? '−' : ''}${money(Math.abs(minor), currency)}`;

/** A share of the largest value, 0–100, for a bar's length or a tick's place. */
const share = (value: number, largest: number) =>
  largest > 0 ? Math.min(100, Math.round((value / largest) * 10000) / 100) : 0;

// --- By Tag ------------------------------------------------------------------------------------

export interface ByTagRow {
  key: string;
  /** The Tag's name, or "Untagged". Written by a Group member: shown as text, never markup. */
  name: string;
  untagged: boolean;
  spentText: string;
  /** Null when there is nothing earlier to average. */
  averageText: string | null;
  /** "+8.9%", "−5.4%", "0.0%", "New" against an average of zero, or "–" with no average. */
  changeText: string;
  direction: ChangeDirection | null;
  /** The bar's length and the average tick's place, 0–100 of the card's largest value. */
  bar: number;
  tick: number | null;
}

export interface ByTagModel {
  currency: string;
  /** "September". */
  monthName: string;
  /** "6-month average" or "August": the legend's tick and the table's column. */
  averageName: string | null;
  /** "September vs the 6-month average, March to August 2026". */
  subtitle: string;
  /** The table's caption, read by assistive technology. */
  caption: string;
  rows: ByTagRow[];
}

/** The By Tag card: the Month's spending per Tag against each Tag's own average. */
export function byTagModel(read: GroupInsightsRead, part: GroupInsightsByTagRead): ByTagModel {
  const { currency } = read;
  const monthName = monthLabel(read.month, 'name');
  const monthLong = monthLabel(read.month, 'long');
  const earlier = part.earlierMonths;
  const name = earlier.length === 0 ? null : averageName(read);
  const against =
    earlier.length === 0
      ? null
      : earlier.length === 1
        ? monthLabel(earlier[0], 'long')
        : `the ${earlier.length}-month average, ${monthsSpan(earlier)}`;
  const largest = Math.max(
    0,
    ...part.tags.map((tag) => Math.max(tag.spentMinor, tag.averageMinor ?? 0)),
  );
  return {
    currency,
    monthName,
    averageName: name,
    subtitle: against ? `${monthName} vs ${against}` : `${monthLong} · nothing earlier to compare`,
    caption: `Spending by Tag in ${monthLong}, in ${currency}, ${
      against ? `against ${against}` : 'with nothing earlier to compare'
    }`,
    rows: part.tags.map((tag) => ({
      key: tag.tagId ?? 'untagged',
      name: tag.name ?? 'Untagged',
      untagged: tag.tagId === null,
      spentText: money(tag.spentMinor, currency),
      averageText: tag.averageMinor === null ? null : money(tag.averageMinor, currency),
      changeText:
        tag.averageMinor === null
          ? '–'
          : tag.changePercent !== null
            ? signedPercent(tag.changePercent)
            : tag.spentMinor > 0
              ? 'New'
              : '–',
      direction: tag.direction,
      bar: share(tag.spentMinor, largest),
      tick: tag.averageMinor === null ? null : share(tag.averageMinor, largest),
    })),
  };
}

// --- Who paid this month -----------------------------------------------------------------------

export interface WhoPaidRow {
  id: string;
  /** "You" for the viewer. Written by the member: shown as text, never markup. */
  name: string;
  /** Their own name, for their initials. */
  avatarName: string;
  /** No longer in the Group, though the Month holds their Expenses. */
  former: boolean;
  paidText: string;
  shareText: string;
  /** "+₹393.00", "−₹930.00" or "₹0.00". */
  netText: string;
  /** "paid more than their share", "paid less than their share", "paid their share". */
  netNote: string;
  netTone: 'positive' | 'negative' | 'neutral';
  /** The Paid bar's length and the Share tick's place, 0–100 of the card's largest value. */
  bar: number;
  tick: number;
}

export interface WhoPaidModel {
  currency: string;
  /** "September 2026". */
  monthLong: string;
  /** "September 2026 · each share is ₹6,140.00", or "· Paid against each share". */
  subtitle: string;
  caption: string;
  /** Nothing was spent in the Month: the card says so instead of a table of zeros. */
  nothingSpent: boolean;
  rows: WhoPaidRow[];
}

/** Who paid this month: each person's Paid against their Share, exact. */
export function whoPaidModel(
  read: GroupInsightsRead,
  part: GroupInsightsWhoPaidRead,
  { userId }: { userId: string },
): WhoPaidModel {
  const { currency } = read;
  const monthLong = monthLabel(read.month, 'long');
  const largest = Math.max(
    0,
    ...part.members.map((member) => Math.max(member.paidMinor, member.shareMinor)),
  );
  const shares = new Set(
    part.members.filter((member) => member.isMember).map((member) => member.shareMinor),
  );
  const [only] = shares;
  const equal = shares.size === 1 && only > 0 && part.members.every((member) => member.isMember);
  return {
    currency,
    monthLong,
    subtitle: equal
      ? `${monthLong} · each share is ${money(only, currency)}`
      : `${monthLong} · Paid against each member’s share`,
    caption: `What each member paid in ${monthLong} against their share, in ${currency}`,
    nothingSpent: part.members.every((member) => member.paidMinor === 0),
    rows: part.members.map((member) => {
      const you = member.id === userId;
      return {
        id: member.id,
        name: you ? 'You' : member.name,
        avatarName: member.name,
        former: !member.isMember,
        paidText: money(member.paidMinor, currency),
        shareText: money(member.shareMinor, currency),
        netText: signedMoney(member.netMinor, currency),
        netNote:
          member.netMinor > 0
            ? `paid more than ${you ? 'your' : 'their'} share`
            : member.netMinor < 0
              ? `paid less than ${you ? 'your' : 'their'} share`
              : `paid ${you ? 'your' : 'their'} share`,
        netTone: member.netMinor > 0 ? 'positive' : member.netMinor < 0 ? 'negative' : 'neutral',
        bar: share(member.paidMinor, largest),
        tick: share(member.shareMinor, largest),
      };
    }),
  };
}

// --- Recurring Expenses ------------------------------------------------------------------------

/** "1st", "2nd", "3rd", "11th", "22nd", "31st". */
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${{ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th'}`;
}

/**
 * A calendar day (`YYYY-MM-DD`) as "Mon 5 Oct", with the year when it isn't `year`. A recurring
 * Expense's day is a calendar day, so it reads the same in every zone: it is built from its
 * parts, at noon, never shifted through UTC.
 */
export function dayLabel(day: string, year: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  return format(date, day.slice(0, 4) === year ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

/** "Priya Shah pays", "You pay", "Sam Chen and Priya Shah pay", "Sam Chen and 2 others pay". */
export function payersOf(paidBy: readonly { id: string; name: string }[], userId: string) {
  const names = paidBy.map((payer) => (payer.id === userId ? 'You' : payer.name));
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} ${names[0] === 'You' ? 'pay' : 'pays'}`;
  if (names.length === 2) return `${names[0]} and ${names[1]} pay`;
  return `${names[0]} and ${names.length - 1} others pay`;
}

export interface RecurringRow {
  id: string;
  /** Written by a Group member: shown as text, never markup. */
  description: string;
  amountText: string;
  /** "Monthly on the 5th · Priya Shah pays". */
  schedule: string;
  /** "Added Sat 5 Sep", or null when it added nothing in the Month. */
  added: string | null;
  /** "Next Mon 5 Oct", "Paused" or "Ended". */
  next: string;
  paused: boolean;
}

export interface RecurringModel {
  currency: string;
  /** "₹4,849.00 · 3 of 14 Expenses in September", or "None added in September". */
  subtitle: string;
  rows: RecurringRow[];
}

/** The Recurring Expenses card: each template's amount and next day. */
export function recurringModel(
  read: GroupInsightsRead,
  part: GroupInsightsRecurringRead,
  { userId, currentMonth }: { userId: string; currentMonth: string },
): RecurringModel {
  const { currency } = read;
  const monthName = monthLabel(read.month, 'name');
  const count = read.months[read.months.length - 1].expenseCount;
  const year = currentMonth.slice(0, 4);
  const { addedInMonth } = part;
  return {
    currency,
    subtitle:
      addedInMonth.count > 0
        ? `${money(addedInMonth.spentMinor, currency)} · ${addedInMonth.count} of ${count} ${
            count === 1 ? 'Expense' : 'Expenses'
          } in ${monthName}`
        : `None added in ${monthName}`,
    rows: part.templates.map((template) => ({
      id: template.id,
      description: template.description,
      amountText: money(template.amountMinor, currency),
      schedule: [
        `Monthly on the ${ordinal(template.dayOfMonth)}${
          template.dayOfMonth > 28 ? ' or the month’s last day' : ''
        }`,
        payersOf(template.paidBy, userId),
      ]
        .filter(Boolean)
        .join(' · '),
      added: template.addedOn ? `Added ${dayLabel(template.addedOn, year)}` : null,
      next: template.nextDate
        ? `Next ${dayLabel(template.nextDate, year)}`
        : template.paused
          ? 'Paused'
          : 'Ended',
      paused: template.paused,
    })),
  };
}
