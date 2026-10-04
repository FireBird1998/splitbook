import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Group from '@/lib/models/Group';
// Registers the model `populate('members.user')` needs, whether or not `User` is used below.
// A fresh server instance loads only the modules of the route it serves, so Balances must not
// rely on another route (#186).
import '@/lib/models/User';
import User from '@/lib/models/User';
import {
  calculateNetBalances,
  calculateNetBalancesMinor,
  simplifyDebts,
  type BalanceExpense,
  type BalanceSettlement,
} from '@splitbook/shared/debt-simplifier';
import { aggregateCurrencyBalances } from '@splitbook/shared/dashboard';
import { assertStoredExpenseMoney } from '@splitbook/shared/exact-money';
import type { DashboardGroupBalance, GroupCategory } from '@splitbook/shared/types';

export class BalanceService {
  /**
   * Calculate balances for a group.
   */
  async getGroupBalances(groupId: string) {
    await connectDB();

    // Get all non-deleted expenses and settlements
    const [expenses, settlements, group] = await Promise.all([
      Expense.find({ group: groupId, isDeleted: false })
        .select('group currency moneyVersion amount amountMinor paidBy splitBetween')
        .lean(),
      Settlement.find({ group: groupId })
        .select('group currency moneyVersion amount amountMinor paidBy paidTo')
        .lean(),
      Group.findById(groupId).populate('members.user', 'name email image').lean(),
    ]);

    if (!group) return null;

    for (const expense of expenses) assertStoredExpenseMoney(expense);
    const currencies = [
      ...new Set([
        group.defaultCurrency,
        ...expenses.map((expense) => expense.currency),
        ...settlements.map((settlement) => settlement.currency),
      ]),
    ].sort();
    const hasMixedCurrencies = currencies.some((currency) => currency !== group.defaultCurrency);

    // Build user info map
    const userMap = new Map<string, { _id: string; name: string; email: string; image?: string }>();
    for (const member of group.members) {
      const user = member.user as unknown as {
        _id: { toString(): string };
        name: string;
        email: string;
        image?: string;
      };
      userMap.set(user._id.toString(), {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        image: user.image,
      });
    }

    const memberIds = new Set(userMap.keys());
    const netByCurrency = currencies.map((currency) => ({
      currency,
      netBalances: calculateNetBalances(
        expensesIn(expenses, currency),
        settlementsIn(settlements, currency),
        currency,
      ),
    }));

    // People who left or were removed keep their place in the ledger. A settled
    // former member is left out; one with an open balance is named from their account.
    const formerIds = [
      ...new Set(
        netByCurrency.flatMap(({ netBalances }) =>
          netBalances
            .filter((balance) => balance.amount !== 0 && !userMap.has(balance.userId))
            .map((balance) => balance.userId),
        ),
      ),
    ];
    if (formerIds.length > 0) {
      const former = await User.find({ _id: { $in: formerIds } })
        .select('name email image')
        .lean();
      for (const user of former) {
        const id = String(user._id);
        userMap.set(id, { _id: id, name: user.name, email: user.email, image: user.image });
      }
    }

    const userInfo = (id: string) => userMap.get(id) || { _id: id, name: 'Unknown', email: '' };
    const byCurrency = netByCurrency.map(({ currency, netBalances: allBalances }) => {
      const netBalances = allBalances.filter(
        (balance) => balance.amount !== 0 || memberIds.has(balance.userId),
      );
      return {
        currency,
        balances: netBalances.map((balance) => ({
          user: userInfo(balance.userId),
          balance: balance.amount,
        })),
        debts: simplifyDebts(netBalances, currency).map((debt) => ({
          from: userInfo(debt.from),
          to: userInfo(debt.to),
          amount: debt.amount,
        })),
      };
    });
    const defaultBalances = byCurrency.find((bucket) => bucket.currency === group.defaultCurrency)!;
    return {
      ...defaultBalances,
      byCurrency,
      hasMixedCurrencies,
    };
  }

  /**
   * The member's non-zero balances in a Group, one per currency, in minor units.
   * Positive: they are owed; negative: they owe. Empty when they are settled up.
   */
  async getMemberOpenBalances(groupId: string, userId: string) {
    await connectDB();

    const [expenses, settlements] = await Promise.all([
      Expense.find({ group: groupId, isDeleted: false })
        .select('group currency moneyVersion amount amountMinor paidBy splitBetween')
        .lean(),
      Settlement.find({ group: groupId })
        .select('group currency moneyVersion amount amountMinor paidBy paidTo')
        .lean(),
    ]);

    for (const expense of expenses) assertStoredExpenseMoney(expense);
    const currencies = [
      ...new Set([
        ...expenses.map((expense) => expense.currency),
        ...settlements.map((settlement) => settlement.currency),
      ]),
    ].sort();

    return currencies.flatMap((currency) => {
      const own = calculateNetBalancesMinor(
        expensesIn(expenses, currency),
        settlementsIn(settlements, currency),
        currency,
      ).find((balance) => balance.userId === userId);
      return own && own.amountMinor !== 0 ? [{ currency, amountMinor: own.amountMinor }] : [];
    });
  }

  /**
   * Get a user's net balance across all groups.
   */
  async getUserBalances(userId: string) {
    await connectDB();

    const groups = await Group.find({
      'members.user': userId,
      isArchived: false,
    })
      .populate('members.user', 'name email image')
      .lean();

    const groupIds = groups.map((group) => group._id);
    const [allExpenses, allSettlements] = await Promise.all([
      Expense.find({ group: { $in: groupIds }, isDeleted: false })
        .select('group currency moneyVersion amount amountMinor paidBy splitBetween')
        .lean(),
      Settlement.find({ group: { $in: groupIds } })
        .select('group currency moneyVersion amount amountMinor paidBy paidTo')
        .lean(),
    ]);

    for (const expense of allExpenses) assertStoredExpenseMoney(expense);
    const expensesByGroup = new Map<string, typeof allExpenses>();
    for (const expense of allExpenses) {
      const key = expense.group.toString();
      const list = expensesByGroup.get(key) || [];
      list.push(expense);
      expensesByGroup.set(key, list);
    }

    const settlementsByGroup = new Map<string, typeof allSettlements>();
    for (const settlement of allSettlements) {
      const key = settlement.group.toString();
      const list = settlementsByGroup.get(key) || [];
      list.push(settlement);
      settlementsByGroup.set(key, list);
    }

    const groupBalances: DashboardGroupBalance[] = [];

    for (const group of groups) {
      const groupId = group._id.toString();
      const expenses = expensesByGroup.get(groupId) || [];
      const settlements = settlementsByGroup.get(groupId) || [];

      const currencies = new Set([
        ...expenses.map((expense) => expense.currency),
        ...settlements.map((settlement) => settlement.currency),
      ]);
      const memberNames = new Map(
        group.members.map((member) => {
          const memberUser = member.user as unknown as {
            _id: { toString(): string };
            name: string;
          };
          return [memberUser._id.toString(), memberUser.name] as const;
        }),
      );

      const balances = [...currencies].sort().flatMap((currency) => {
        const expenseData = expenses
          .filter((expense) => expense.currency === currency)
          .map((expense) => ({
            currency: expense.currency,
            moneyVersion: expense.moneyVersion,
            paidBy: expense.paidBy.map((payer) => ({
              user: payer.user.toString(),
              amount: payer.amount,
              amountMinor: payer.amountMinor,
            })),
            splitBetween: expense.splitBetween.map((split) => ({
              user: split.user.toString(),
              amount: split.amount,
              amountMinor: split.amountMinor,
            })),
          }));
        const settlementData = settlements
          .filter((settlement) => settlement.currency === currency)
          .map((settlement) => ({
            currency: settlement.currency,
            moneyVersion: settlement.moneyVersion,
            amountMinor: settlement.amountMinor,
            paidBy: settlement.paidBy.toString(),
            paidTo: settlement.paidTo.toString(),
            amount: settlement.amount,
          }));
        const netBalances = calculateNetBalances(expenseData, settlementData, currency);
        const userBalance = netBalances.find((balance) => balance.userId === userId);

        if (!userBalance || userBalance.amount === 0) return [];

        const settlement = simplifyDebts(netBalances, currency)
          .filter(
            (debt) =>
              (userBalance.amount < 0 && debt.from === userId) ||
              (userBalance.amount > 0 && debt.to === userId),
          )
          .sort((a, b) => b.amount - a.amount)[0];
        const counterpartyId = settlement
          ? settlement.from === userId
            ? settlement.to
            : settlement.from
          : undefined;

        return [
          {
            currency,
            balance: userBalance.amount,
            ...(settlement && counterpartyId
              ? {
                  settlement: {
                    counterpartyId,
                    counterpartyName: memberNames.get(counterpartyId) || 'Unknown',
                    amount: settlement.amount,
                  },
                }
              : {}),
          },
        ];
      });

      groupBalances.push({
        groupId,
        name: group.name,
        category: group.category as GroupCategory,
        updatedAt: new Date(group.updatedAt).toISOString(),
        hasMixedCurrencies: currencies.size > 1,
        balances,
      });
    }

    return {
      buckets: aggregateCurrencyBalances(groupBalances),
      groups: groupBalances,
      hasMixedCurrencies: groupBalances.some((group) => group.hasMixedCurrencies),
    };
  }
}

export const balanceService = new BalanceService();

interface StoredParticipant {
  user: unknown;
  amount: number;
  amountMinor?: number;
}

/** The fields of a stored Expense that balances read. */
interface StoredExpenseMoney {
  currency: string;
  moneyVersion?: number;
  paidBy: StoredParticipant[];
  splitBetween: StoredParticipant[];
}

/** The fields of a stored Settlement that balances read. */
interface StoredSettlementMoney {
  currency: string;
  moneyVersion?: number;
  paidBy: unknown;
  paidTo: unknown;
  amount: number;
  amountMinor?: number;
}

const participant = ({ user, amount, amountMinor }: StoredParticipant) => ({
  user: String(user),
  amount,
  amountMinor,
});

/** One currency's Expenses, shaped for the shared balance calculation. */
function expensesIn(expenses: StoredExpenseMoney[], currency: string): BalanceExpense[] {
  return expenses
    .filter((expense) => expense.currency === currency)
    .map((expense) => ({
      currency: expense.currency,
      moneyVersion: expense.moneyVersion,
      paidBy: expense.paidBy.map(participant),
      splitBetween: expense.splitBetween.map(participant),
    }));
}

/** One currency's Settlements, shaped for the shared balance calculation. */
function settlementsIn(
  settlements: StoredSettlementMoney[],
  currency: string,
): BalanceSettlement[] {
  return settlements
    .filter((settlement) => settlement.currency === currency)
    .map((settlement) => ({
      currency: settlement.currency,
      moneyVersion: settlement.moneyVersion,
      paidBy: String(settlement.paidBy),
      paidTo: String(settlement.paidTo),
      amount: settlement.amount,
      amountMinor: settlement.amountMinor,
    }));
}
