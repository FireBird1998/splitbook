import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupRead } from '@splitbook/shared/group-read';
import { parseMonthParam } from '@/components/groups/MonthCycleBar';
import { groupIdInPath } from '@/components/layout/shell-nav';

/**
 * The pure parts of the top bar's Add expense (#304): where it adds an Expense from a given
 * page, which Groups it offers, and what it says. Unit-tested without a DOM.
 */

/** Inside a Group the form opens for that Group; anywhere else the member chooses one first. */
export type AddExpenseTarget = { kind: 'group'; groupId: string } | { kind: 'choose' };

export function addExpenseTarget(pathname: string): AddExpenseTarget {
  const groupId = groupIdInPath(pathname);
  return groupId ? { kind: 'group', groupId } : { kind: 'choose' };
}

/** The Groups the chooser offers: active ones only, never an archived Group. */
export function activeGroups(groups: readonly GroupRead[]): GroupRead[] {
  return groups.filter((group) => !group.isArchived);
}

/** "Household · 3 members · INR": a chooser row's second line. */
export function groupChoiceDetail(group: GroupRead): string {
  const members = group.members.length;
  return [
    getGroupTheme(group.category).label,
    `${members} ${members === 1 ? 'member' : 'members'}`,
    group.defaultCurrency,
  ].join(' · ');
}

/**
 * The date a new Expense starts on, as the Group page's own Add expense picks it: a Household
 * viewed at a past Month (`?month=YYYY-MM`) defaults to that Month's last day in the viewer's
 * zone; otherwise null, which the form reads as today.
 */
export function addExpenseDefaultDate(
  group: Pick<GroupRead, 'category'>,
  monthParam: string | null,
  now: Date = new Date(),
): string | null {
  if (getGroupTheme(group.category).signature !== 'monthCycle') return null;
  const month = parseMonthParam(monthParam, now);
  if (!month || month.isCurrentMonth) return null;
  return `${month.key}-${String(month.lastDay.getDate()).padStart(2, '0')}`;
}

/** The confirmation after a save, naming the Group the Expense went to. */
export function expenseAddedMessage(groupName: string): string {
  return `Expense added to ${groupName}`;
}
