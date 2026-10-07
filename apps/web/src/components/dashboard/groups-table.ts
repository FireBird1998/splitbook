/**
 * What Home's Groups table shows (#308, design canvas "Web portal"): for each of the member's
 * Groups, its Theme (with the dates of a Trip), its members, what it spent this Month, the
 * member's balance there and when it last changed. Each figure comes from its own read and is
 * loading, unavailable or ready on its own. Pure, so the table and the phone rows agree.
 */
import { isSameDay, format, subDays } from 'date-fns';
import { formatCurrency } from '@splitbook/shared/currency';
import { readLegacyAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import type { GroupRead } from '@splitbook/shared/group-read';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { formatSignedCurrency } from '@splitbook/shared/money';
import type { GroupCategory } from '@splitbook/shared/types';
import type {
  GroupLastChangeRead,
  SpendingThisMonthRead,
} from '@splitbook/shared/user-spending-read';
import { initials } from '@/components/layout/AccountMenu';
import { membersLabel, viewerFirst } from '@/components/groups/group-tabs';
import type { CardRead, GroupBalanceAmounts } from './home-reads';
import { monthLabel } from './spending-chart';

/** A figure from a read: still loading, not known (the read failed or lacks it), or known. */
export type Figure<T> =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; value: T };

export interface MoneyLine {
  currency: string;
  /** "₹18,420.00", or signed for a balance: "−₹1,480.00", "+₹620.00". */
  text: string;
}

export interface SpentLine extends MoneyLine {
  /** Nothing spent: shown quieter. */
  zero: boolean;
}

export interface BalanceLine extends MoneyLine {
  tone: 'negative' | 'positive';
  /** What the sign means, for screen readers: "you owe ₹1,480.00". */
  spoken: string;
}

export type GroupBalance = { kind: 'settled' } | { kind: 'open'; lines: BalanceLine[] };

export interface GroupPersonChip {
  id: string;
  name: string;
  initials: string;
  image?: string;
}

export interface GroupsTableRow {
  groupId: string;
  href: string;
  name: string;
  category: GroupCategory;
  /** "Household", or "Trip · Sep 17–20". */
  themeLine: string;
  members: {
    /** "Members: you, Sam Chen and Priya Shah". */
    label: string;
    shown: GroupPersonChip[];
    /** Members past the shown avatars: "+6". */
    more: number;
  };
  spent: Figure<SpentLine[]>;
  balance: Figure<GroupBalance>;
  /** Null when the Group has no Activity at all. */
  lastChange: Figure<{ at: string; text: string } | null>;
}

/** Avatars shown in a row; past that, the first ones and "+N". */
const MAX_AVATARS = 3;

const utcDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const utcMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const utcDate = (value: string) => new Date(value);

/**
 * A Trip's dates as the table shows them: "Sep 17–20", "Sep 29 – Oct 2", with the year when it
 * isn't this year's. Trip dates are calendar days, stored at midnight UTC, so they are read in
 * UTC whatever the viewer's zone.
 */
export function tripDatesLabel(
  startDate: string | null,
  endDate: string | null,
  now: Date,
): string | null {
  const start = startDate ? utcDate(startDate) : null;
  const end = endDate ? utcDate(endDate) : null;
  const year = (date: Date) => date.getUTCFullYear();
  const thisYear = now.getFullYear();
  const withYear = (label: string, date: Date) =>
    year(date) === thisYear ? label : `${label}, ${year(date)}`;
  if (start && end) {
    if (year(start) !== year(end))
      return `${withYear(utcDay.format(start), start)} – ${withYear(utcDay.format(end), end)}`;
    if (start.getTime() === end.getTime()) return withYear(utcDay.format(start), start);
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    const range = sameMonth
      ? `${utcMonth.format(start)} ${start.getUTCDate()}–${end.getUTCDate()}`
      : `${utcDay.format(start)} – ${utcDay.format(end)}`;
    return withYear(range, start);
  }
  if (start) return `From ${withYear(utcDay.format(start), start)}`;
  if (end) return `Until ${withYear(utcDay.format(end), end)}`;
  return null;
}

/** "Household", or for a Trip "Trip · Sep 17–20" when it has dates. */
export function themeLine(group: Pick<GroupRead, 'category' | 'startDate' | 'endDate'>, now: Date) {
  const theme = getGroupTheme(group.category);
  const dates =
    theme.dates === 'bounded' ? tripDatesLabel(group.startDate, group.endDate, now) : null;
  return dates ? `${theme.label} · ${dates}` : theme.label;
}

/**
 * When a Group last changed, in the viewer's own zone: "Today, 9:14 AM", "Yesterday, 8:02 PM",
 * "Sep 27", or "Sep 27, 2025" in another year.
 */
export function lastChangeLabel(at: string | Date, now: Date): string {
  const date = new Date(at);
  // A no-break space keeps "9:14 AM" together when a narrow table wraps the label.
  const time = format(date, 'h:mm\u00a0a');
  if (isSameDay(date, now)) return `Today, ${time}`;
  if (isSameDay(date, subDays(now, 1))) return `Yesterday, ${time}`;
  return format(date, date.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

/** "Spent in October", or "Spent this month" until the read says which Month that is. */
export function spentHeading(thisMonth: CardRead<SpendingThisMonthRead>): string {
  return thisMonth.status === 'ready'
    ? `Spent in ${monthLabel(thisMonth.value.month, 'name')}`
    : 'Spent this month';
}

/** The Group's own currency first, then the others in the order given. */
function ownCurrencyFirst<T extends { currency: string }>(lines: T[], currency: string): T[] {
  return [
    ...lines.filter((line) => line.currency === currency),
    ...lines.filter((line) => line.currency !== currency),
  ];
}

function spentFigure(
  group: GroupRead,
  thisMonth: CardRead<SpendingThisMonthRead>,
): Figure<SpentLine[]> {
  if (thisMonth.status !== 'ready')
    return { status: thisMonth.status === 'error' ? 'unavailable' : 'loading' };
  const entry = thisMonth.value.groups.find((candidate) => candidate.groupId === group._id);
  // A Group the read doesn't cover yet (created since it answered) has no figure to claim.
  if (!entry) return { status: 'unavailable' };
  try {
    const lines = entry.spent.map(({ currency, totalMinor }) => ({
      currency,
      text: formatCurrency(toMajorAmount(totalMinor, currency), currency),
      zero: totalMinor === 0,
    }));
    return {
      status: 'ready',
      value: lines.length
        ? ownCurrencyFirst(lines, group.defaultCurrency)
        : [
            {
              currency: group.defaultCurrency,
              text: formatCurrency(0, group.defaultCurrency),
              zero: true,
            },
          ],
    };
  } catch {
    return { status: 'unavailable' };
  }
}

function balanceFigure(
  group: GroupRead,
  balances: CardRead<Map<string, GroupBalanceAmounts>>,
): Figure<GroupBalance> {
  if (balances.status !== 'ready')
    return { status: balances.status === 'error' ? 'unavailable' : 'loading' };
  const amounts = balances.value.get(group._id);
  if (!amounts) return { status: 'unavailable' };
  try {
    // Exact minor units, each currency on its own: nothing is converted or added across them.
    const open = amounts
      .map(({ currency, balance }) => ({
        currency,
        minor: readLegacyAmountMinor(balance, currency),
      }))
      .filter(({ minor }) => minor !== 0);
    if (open.length === 0) return { status: 'ready', value: { kind: 'settled' } };
    const lines = open.map(({ currency, minor }): BalanceLine => {
      const amount = toMajorAmount(minor, currency);
      const unsigned = formatCurrency(Math.abs(amount), currency);
      return {
        currency,
        text: formatSignedCurrency(amount, currency),
        tone: minor < 0 ? 'negative' : 'positive',
        spoken: minor < 0 ? `you owe ${unsigned}` : `you are owed ${unsigned}`,
      };
    });
    return {
      status: 'ready',
      value: { kind: 'open', lines: ownCurrencyFirst(lines, group.defaultCurrency) },
    };
  } catch {
    // An amount that can't be read exactly is never shown rounded.
    return { status: 'unavailable' };
  }
}

function lastChangeFigure(
  groupId: string,
  lastChanges: CardRead<GroupLastChangeRead[]>,
  now: Date,
): Figure<{ at: string; text: string } | null> {
  if (lastChanges.status !== 'ready')
    return { status: lastChanges.status === 'error' ? 'unavailable' : 'loading' };
  const entry = lastChanges.value.find((candidate) => candidate.groupId === groupId);
  if (!entry) return { status: 'unavailable' };
  return {
    status: 'ready',
    value: entry.at ? { at: entry.at, text: lastChangeLabel(entry.at, now) } : null,
  };
}

/** The table's rows, in the Groups read's order: the sidebar's order. */
export function groupsTableRows({
  groups,
  userId,
  balances,
  thisMonth,
  lastChanges,
  now,
}: {
  groups: readonly GroupRead[];
  userId: string;
  balances: CardRead<Map<string, GroupBalanceAmounts>>;
  thisMonth: CardRead<SpendingThisMonthRead>;
  lastChanges: CardRead<GroupLastChangeRead[]>;
  now: Date;
}): GroupsTableRow[] {
  return groups.map((group) => {
    const people = viewerFirst(group.members, userId).map(({ user }) => user);
    const shown = people.slice(0, people.length > MAX_AVATARS ? MAX_AVATARS - 1 : MAX_AVATARS);
    return {
      groupId: group._id,
      href: `/groups/${group._id}`,
      name: group.name,
      category: group.category,
      themeLine: themeLine(group, now),
      members: {
        label: membersLabel(people, userId),
        shown: shown.map((person) => ({
          id: person._id,
          name: person.name,
          initials: initials(person.name),
          image: person.image,
        })),
        more: people.length - shown.length,
      },
      spent: spentFigure(group, thisMonth),
      balance: balanceFigure(group, balances),
      lastChange: lastChangeFigure(group._id, lastChanges, now),
    };
  });
}
