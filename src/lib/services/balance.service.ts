import connectDB from '@/lib/db';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Group from '@/lib/models/Group';
import { calculateNetBalances, simplifyDebts } from '@/lib/utils/debt-simplifier';

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
    }).lean();

    const groupBalances = [];

    for (const group of groups) {
      const [expenses, settlements] = await Promise.all([
        Expense.find({ group: group._id, isDeleted: false }).lean(),
        Settlement.find({ group: group._id }).lean(),
      ]);

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
      const userBalance = netBalances.find((b) => b.userId === userId);

      if (userBalance && Math.abs(userBalance.amount) >= 0.01) {
        groupBalances.push({
          group: {
            _id: group._id.toString(),
            name: group.name,
            category: group.category,
            defaultCurrency: group.defaultCurrency,
          },
          balance: userBalance.amount,
          currency: group.defaultCurrency,
        });
      }
    }

    return groupBalances;
  }
}

export const balanceService = new BalanceService();
