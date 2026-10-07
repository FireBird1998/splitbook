/**
 * What the search dialog lists for a search read (#321), and where each result goes. Pure, so
 * the addresses and wording are unit-tested without rendering.
 */
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { formatDate } from '@splitbook/shared/date';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type {
  SearchExpenseResult,
  SearchGroupResult,
  SearchPersonResult,
  SearchRead,
} from '@splitbook/shared/search-read';
import type { GroupCategory } from '@splitbook/shared/types';
import { openExpenseQuery } from '@/components/expenses/expense-list-query';
import { groupTabHref } from '@/components/groups/group-tabs';

export type SearchSectionKey = 'groups' | 'people' | 'expenses';

interface OptionBase {
  /** Unique within one read: the section and the record's id. */
  key: string;
  href: string;
  /** The text the query is highlighted in. */
  title: string;
  /** The line under it. */
  detail: string;
}

export type SearchOption =
  | (OptionBase & { kind: 'group'; category: GroupCategory })
  | (OptionBase & { kind: 'person'; initials: string })
  | (OptionBase & { kind: 'expense'; amount: string | null });

export interface SearchSection {
  key: SearchSectionKey;
  label: string;
  options: SearchOption[];
  /** More matched than the read returned. */
  more: boolean;
}

/** A Group opens at its own address, which lands on the Group's first tab (#305). */
export const groupHref = (groupId: string) => `/groups/${encodeURIComponent(groupId)}`;

/**
 * An Expense opens in its Group's Expenses tab (#311): in the side panel on a computer, and
 * below its card on a phone, with the list searched for its description so its row is in view.
 */
export const expenseHref = (expense: Pick<SearchExpenseResult, 'id' | 'groupId' | 'description'>) =>
  groupTabHref(
    expense.groupId,
    'expenses',
    openExpenseQuery(expense.id, { search: expense.description }),
  );

/** Up to two initials, as the sidebar's account avatar shows them. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((word) => Array.from(word)[0]?.toUpperCase() ?? '').join('') || '?';
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function groupOption(group: SearchGroupResult): SearchOption {
  const category = group.category as GroupCategory;
  return {
    kind: 'group',
    key: `group:${group.id}`,
    href: groupHref(group.id),
    title: group.name,
    detail: `${getGroupTheme(category).label} · ${plural(group.memberCount, 'member', 'members')}`,
    category,
  };
}

function personOption(person: SearchPersonResult): SearchOption {
  const others = person.groupCount - 1;
  return {
    kind: 'person',
    key: `person:${person.id}`,
    // The first Group the member shares with them, in the order of their Group list.
    href: groupHref(person.groupId),
    title: person.name,
    detail:
      others > 0
        ? `In ${person.groupName} and ${plural(others, 'other Group', 'other Groups')}`
        : `In ${person.groupName}`,
    initials: initialsOf(person.name),
  };
}

/** The amount in its own currency, or null when it can't be shown exactly. */
function expenseAmount(expense: SearchExpenseResult): string | null {
  if (expense.amountMinor === null) return null;
  try {
    return formatCurrency(toMajorAmount(expense.amountMinor, expense.currency), expense.currency);
  } catch {
    return null;
  }
}

function expenseOption(expense: SearchExpenseResult): SearchOption {
  return {
    kind: 'expense',
    key: `expense:${expense.id}`,
    href: expenseHref(expense),
    title: expense.description,
    detail: `${expense.groupName} · ${formatDate(expense.date)}`,
    amount: expenseAmount(expense),
  };
}

/** The read's sections in the dialog's order, leaving out the empty ones. */
export function searchSections(read: SearchRead): SearchSection[] {
  const sections: SearchSection[] = [
    {
      key: 'groups',
      label: 'Groups',
      options: read.groups.map(groupOption),
      more: read.more.groups,
    },
    {
      key: 'people',
      label: 'People',
      options: read.people.map(personOption),
      more: read.more.people,
    },
    {
      key: 'expenses',
      label: 'Expenses',
      options: read.expenses.map(expenseOption),
      more: read.more.expenses,
    },
  ];
  return sections.filter((section) => section.options.length > 0);
}

/** What a screen reader hears once results arrive: "2 Groups, 1 person and 8 Expenses". */
export function resultsSummary(sections: readonly SearchSection[]): string {
  const counts = sections.map(({ key, options: { length } }) =>
    key === 'groups'
      ? plural(length, 'Group', 'Groups')
      : key === 'people'
        ? plural(length, 'person', 'people')
        : plural(length, 'Expense', 'Expenses'),
  );
  if (counts.length === 0) return 'No results';
  return counts.length === 1
    ? counts[0]
    : `${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}`;
}
