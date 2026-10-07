import type {
  CurrencyBalanceBucket,
  DashboardGroupBalance,
  DashboardNextAction,
  HomeSuggestedPayment,
  SuggestedPaymentDirection,
} from './types';

import {
  assertSafeMinorAmount,
  readLegacyAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';

/** A suggested payment in one Group and currency, as `simplifyDebtsMinor` returns it. */
export interface MinorTransaction {
  from: string;
  to: string;
  amountMinor: number;
}

/** A suggested payment seen from one member: who the other person is, and which way it goes. */
export interface MemberSuggestedPayment {
  direction: SuggestedPaymentDirection;
  counterpartyId: string;
  amountMinor: number;
}

/**
 * The suggested payments in one Group and currency where the member pays or receives, in the
 * order they were suggested. Payments between two other people are left out, and so is any of
 * zero (the simplifier never suggests one).
 */
export function memberSuggestedPayments(
  transactions: readonly MinorTransaction[],
  memberId: string,
): MemberSuggestedPayment[] {
  return transactions.flatMap(({ from, to, amountMinor }): MemberSuggestedPayment[] => {
    if (assertSafeMinorAmount(amountMinor) <= 0 || from === to) return [];
    if (from === memberId) return [{ direction: 'pay', counterpartyId: to, amountMinor }];
    if (to === memberId) return [{ direction: 'receive', counterpartyId: from, amountMinor }];
    return [];
  });
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Needs you's order: the payments the member makes first, then the ones they receive. Within
 * each, by currency, the largest amount first, then by Group and person, so the order never
 * depends on the order the Groups were read in. Amounts in different currencies are never
 * compared.
 */
export function orderSuggestedPayments<T extends HomeSuggestedPayment>(
  payments: readonly T[],
): T[] {
  return [...payments].sort(
    (a, b) =>
      (a.direction === b.direction ? 0 : a.direction === 'pay' ? -1 : 1) ||
      compareText(a.currency, b.currency) ||
      b.amountMinor - a.amountMinor ||
      compareText(a.groupName, b.groupName) ||
      compareText(a.groupId, b.groupId) ||
      compareText(a.counterpartyName, b.counterpartyName) ||
      compareText(a.counterpartyId, b.counterpartyId),
  );
}

/** One currency of the member's balances on Home, in exact minor units. */
export interface HomeCurrencyBalance {
  currency: string;
  /** What the member is owed less what they owe: below zero they owe overall. */
  netMinor: number;
  youOweMinor: number;
  owedToYouMinor: number;
  /**
   * How many Groups the figures cover: the Groups where the member's balance in this currency
   * is not zero. A Group where they are settled up in it adds nothing, so it isn't counted.
   */
  groupCount: number;
}

/**
 * Home's balances, one per currency and never converted, from the balances read's totals and
 * its Groups. Every amount is read in exact minor units; one that can't be read exactly throws
 * (`MoneyValidationError`) rather than show a rounded figure. The currency with the most
 * Groups comes first, then by currency code.
 */
export function homeCurrencyBalances(
  buckets: ReadonlyArray<Pick<CurrencyBalanceBucket, 'currency' | 'youOwe' | 'youAreOwed'>>,
  groups: ReadonlyArray<{ balances: ReadonlyArray<{ currency: string; balance: number }> }>,
): HomeCurrencyBalance[] {
  return buckets
    .map(({ currency, youOwe, youAreOwed }) => {
      const youOweMinor = readLegacyAmountMinor(youOwe, currency);
      const owedToYouMinor = readLegacyAmountMinor(youAreOwed, currency);
      const groupCount = groups.filter((group) =>
        group.balances.some(
          (item) =>
            item.currency === currency && readLegacyAmountMinor(item.balance, currency) !== 0,
        ),
      ).length;
      return {
        currency,
        netMinor: sumMinorAmounts([owedToYouMinor, -youOweMinor]),
        youOweMinor,
        owedToYouMinor,
        groupCount,
      };
    })
    .sort((a, b) => b.groupCount - a.groupCount || compareText(a.currency, b.currency));
}

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

      const balanceMinor = readLegacyAmountMinor(item.balance, item.currency);
      if (balanceMinor < 0) {
        bucket.youOwe = sumMinorAmounts([bucket.youOwe, -balanceMinor]);
      } else {
        bucket.youAreOwed = sumMinorAmounts([bucket.youAreOwed, balanceMinor]);
      }
      bucket.net = sumMinorAmounts([bucket.youAreOwed, -bucket.youOwe]);
      buckets.set(item.currency, bucket);
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      currency: bucket.currency,
      youOwe: toMajorAmount(bucket.youOwe, bucket.currency),
      youAreOwed: toMajorAmount(bucket.youAreOwed, bucket.currency),
      net: toMajorAmount(bucket.net, bucket.currency),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
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
