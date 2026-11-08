import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { WidgetGroupPart } from '@splitbook/shared/group-widget';
import type { MobileGroup, GroupCurrencyBalance } from './types';

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
          toName: row.to.name.trim().split(/\s+/)[0],
          amountMinor: parseAmountMinor(row.amount, bucket.currency),
        })),
    })),
  };
}
