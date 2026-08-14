import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Group from '@/lib/models/Group';
import { calculateNetBalances, simplifyDebts } from '@/lib/utils/debt-simplifier';
import { aggregateCurrencyBalances } from '@/lib/utils/dashboard';
import type { DashboardCounterparty, DashboardGroupBalance, GroupCategory } from '@/types';

export class BalanceService {
  /**
   * Calculate balances for a group.
   */
  async getGroupBalances(groupId: string) {
    await connectDB();

    // Get all non-deleted expenses and settlements
    const [expenses, settlements, group] = await Promise.all([
      Expense.find({ group: groupId, isDeleted: false }).lean(),
      Settlement.find({ group: groupId }).lean(),
      Group.findById(groupId).populate('members.user', 'name email image').lean(),
    ]);

    if (!group) return null;

    const hasMixedCurrencies =
      expenses.some((e) => e.currency !== group.defaultCurrency) ||
      settlements.some((s) => s.currency !== group.defaultCurrency);

    // Calculate net balances
    const expenseData = expenses.map((e) => ({
      paidBy: e.paidBy.map((p) => ({
        user: p.user.toString(),
        amount: p.amount,
      })),
      splitBetween: e.splitBetween.map((s) => ({
        user: s.user.toString(),
        amount: s.amount,
      })),
    }));

    const settlementData = settlements.map((s) => ({
      paidBy: s.paidBy.toString(),
      paidTo: s.paidTo.toString(),
      amount: s.amount,
    }));

    const netBalances = calculateNetBalances(expenseData, settlementData);

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

    // Map balances to include user info
    const balances = netBalances.map((b) => ({
      user: userMap.get(b.userId) || {
        _id: b.userId,
        name: 'Unknown',
        email: '',
      },
      balance: b.amount,
    }));

    // Calculate simplified debts
    const simplifiedTransactions = simplifyDebts(netBalances);
    const debts = simplifiedTransactions.map((t) => ({
      from: userMap.get(t.from) || { _id: t.from, name: 'Unknown', email: '' },
      to: userMap.get(t.to) || { _id: t.to, name: 'Unknown', email: '' },
      amount: t.amount,
    }));

    return {
      balances,
      debts,
      currency: group.defaultCurrency,
      hasMixedCurrencies,
    };
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
      Expense.find({ group: { $in: groupIds }, isDeleted: false }).lean(),
      Settlement.find({ group: { $in: groupIds } }).lean(),
    ]);

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
            paidBy: expense.paidBy.map((payer) => ({
              user: payer.user.toString(),
              amount: payer.amount,
            })),
            splitBetween: expense.splitBetween.map((split) => ({
              user: split.user.toString(),
              amount: split.amount,
            })),
          }));
        const settlementData = settlements
          .filter((settlement) => settlement.currency === currency)
          .map((settlement) => ({
            paidBy: settlement.paidBy.toString(),
            paidTo: settlement.paidTo.toString(),
            amount: settlement.amount,
          }));
        const netBalances = calculateNetBalances(expenseData, settlementData);
        const userBalance = netBalances.find((balance) => balance.userId === userId);

        if (!userBalance || Math.abs(userBalance.amount) < 0.01) return [];

        const userDebts = simplifyDebts(netBalances)
          .filter(
            (debt) =>
              (userBalance.amount < 0 && debt.from === userId) ||
              (userBalance.amount > 0 && debt.to === userId),
          )
          .sort((a, b) => b.amount - a.amount);

        const counterparties: DashboardCounterparty[] = userDebts.map((debt) => {
          const counterpartyId = debt.from === userId ? debt.to : debt.from;
          return {
            counterpartyId,
            counterpartyName: memberNames.get(counterpartyId) || 'Unknown',
            amount: debt.amount,
            direction: debt.from === userId ? 'owe' : 'owed',
          };
        });

        const [settlement] = counterparties;

        return [
          {
            currency,
            balance: userBalance.amount,
            counterparties,
            ...(settlement
              ? {
                  settlement: {
                    counterpartyId: settlement.counterpartyId,
                    counterpartyName: settlement.counterpartyName,
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
