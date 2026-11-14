import { expenseDay } from '@splitbook/shared/expense-day';
import { initials } from '../initials';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { WidgetGroupPart } from '@splitbook/shared/group-widget';
import type { MobileGroup, GroupCurrencyBalance } from './types';
import type { WidgetGroupPeople } from '@splitbook/shared/widget-people';

export function widgetGroupPeople(group: MobileGroup, verifiedAt: number): WidgetGroupPeople {
  return {
    name: group.name,
    archived: !!group.isArchived,
    verifiedAt,
    people: group.members.map(({ user }) => ({
      id: user.id,
      firstName: user.name.trim().split(/\s+/)[0],
      initials: initials(user.name),
    })),
  };
}

/** A projection of existing reads, never a balance computation or a new request. */
export function widgetGroupCopy(
  group: MobileGroup,
  balances: GroupCurrencyBalance[],
  accountId: string,
  verifiedAt: number,
  balancesVerifiedAt: number,
): WidgetGroupPart {
  return {
    id: group.id,
    name: group.name,
    theme: group.category,
    archived: !!group.isArchived,
    mainCurrency: group.defaultCurrency,
    verifiedAt,
    balancesVerifiedAt,
    tripDates: {
      start: group.startDate ? expenseDay(group.startDate) : null,
      end: group.endDate ? expenseDay(group.endDate) : null,
    },
    currencies: balances.map((bucket) => ({
      currency: bucket.currency,
      balanceMinor:
        parseAmountMinor(
          Math.abs(bucket.balances.find((row) => row.user.id === accountId)?.balance ?? 0),
          bucket.currency,
        ) * ((bucket.balances.find((row) => row.user.id === accountId)?.balance ?? 0) < 0 ? -1 : 1),
      payments: bucket.debts
        .filter((row) => row.from.id === accountId || row.to.id === accountId)
        .map((row) => ({
          from: row.from.id,
          to: row.to.id,
          fromName: row.from.name.trim().split(/\s+/)[0],
          fromInitials: initials(row.from.name),
          toName: row.to.name.trim().split(/\s+/)[0],
          toInitials: initials(row.to.name),
          amountMinor: parseAmountMinor(row.amount, bucket.currency),
        })),
    })),
  };
}
