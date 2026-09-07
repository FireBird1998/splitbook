import type { CurrencyBalanceBucket, DashboardGroupBalance, DashboardNextAction } from '@/types';

const roundMoney = (amount: number) => {
  const sign = Math.sign(amount) || 1;
  return (sign * Math.round((Math.abs(amount) + Number.EPSILON) * 100)) / 100;
};

export function aggregateCurrencyBalances(
  groups: DashboardGroupBalance[],
): CurrencyBalanceBucket[] {
  const buckets = new Map<string, CurrencyBalanceBucket>();

  for (const group of groups) {
    for (const item of group.balances) {
      const bucket = buckets.get(item.currency) || {
        currency: item.currency,
        youOwe: 0,
        youAreOwed: 0,
        net: 0,
      };

      if (item.balance < 0) {
        bucket.youOwe = roundMoney(bucket.youOwe + Math.abs(item.balance));
      } else {
        bucket.youAreOwed = roundMoney(bucket.youAreOwed + item.balance);
      }
      bucket.net = roundMoney(bucket.youAreOwed - bucket.youOwe);
      buckets.set(item.currency, bucket);
    }
  }

  return [...buckets.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function selectNextAction(
  groups: DashboardGroupBalance[],
  pendingInvitationCount: number,
): DashboardNextAction {
  if (groups.length === 0) {
    return {
      kind: 'create-group',
      title: 'Create your first group',
      description: 'Start a shared ledger and invite the people you split costs with.',
      href: '/groups/new',
    };
  }

  const payable = groups
    .flatMap((group) =>
      group.balances
        .filter((item) => item.balance < 0 && item.settlement)
        .map((item) => ({ group, item, settlement: item.settlement! })),
    )
    .sort((a, b) => {
      const amountDelta = b.settlement.amount - a.settlement.amount;
      if (amountDelta !== 0) return amountDelta;
      return Date.parse(b.group.updatedAt) - Date.parse(a.group.updatedAt);
    })[0];

  if (payable) {
    return {
      kind: 'settle',
      title: `Settle with ${payable.settlement.counterpartyName}`,
      description: `${payable.group.name} has an outstanding payment ready to record.`,
      href: `/groups/${payable.group.groupId}?tab=balances`,
      groupId: payable.group.groupId,
      counterpartyName: payable.settlement.counterpartyName,
      amount: payable.settlement.amount,
      currency: payable.item.currency,
    };
  }

  if (pendingInvitationCount > 0) {
    return {
      kind: 'review-invitations',
      title: 'Review your group invitation',
      description: `${pendingInvitationCount} invitation${pendingInvitationCount === 1 ? '' : 's'} waiting for you.`,
      href: '#pending-actions',
    };
  }

  const latestGroup = [...groups].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0];

  return {
    kind: 'add-expense',
    title: `Add an expense to ${latestGroup.name}`,
    description: 'Keep the shared ledger current while the details are fresh.',
    href: `/groups/${latestGroup.groupId}?action=add-expense`,
    groupId: latestGroup.groupId,
  };
}
