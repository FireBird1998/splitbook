import connectDB from '@/lib/db';
import Group from '@/lib/models/Group';
import Settlement from '@/lib/models/Settlement';
import { activityService } from './activity.service';
import {
  assertGroupCurrency,
  assertSettlementAuthorization,
  assertSettlementMembers,
} from '@splitbook/shared/expense-validation';
import type { CreateSettlementInput } from '@splitbook/shared/validators/settlement';

export class SettlementService {
  /**
   * Record a new settlement.
   * Either the payer or the recipient may record it when authorized.
   */
  async create(groupId: string, data: CreateSettlementInput, userId: string) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) throw new Error('Group not found');

    const memberIds = new Set(group.members.map((member) => member.user.toString()));
    const paidBy = data.paidBy || userId;

    assertSettlementMembers(memberIds, paidBy, data.paidTo);
    assertSettlementAuthorization(userId, paidBy, data.paidTo);
    assertGroupCurrency(group.defaultCurrency, data.currency);

    const settlement = await Settlement.create({
      group: groupId,
      paidBy,
      paidTo: data.paidTo,
      amount: data.amount,
      currency: data.currency,
      note: data.note,
      createdBy: userId,
    });

    const populated = await settlement.populate([
      { path: 'paidBy', select: 'name email image' },
      { path: 'paidTo', select: 'name email image' },
      { path: 'createdBy', select: 'name email image' },
    ]);

    const paidByDoc = populated.paidBy as unknown as { name?: string };
    const paidToDoc = populated.paidTo as unknown as { name?: string };

    await activityService.log(groupId, 'settlement_recorded', userId, {
      settlementId: settlement._id.toString(),
      paidBy: paidBy,
      paidTo: data.paidTo,
      paidByName: paidByDoc?.name,
      paidToName: paidToDoc?.name,
      amount: data.amount,
      currency: data.currency,
    });

    return populated;
  }

  /**
   * Get all settlements for a group.
   */
  async getGroupSettlements(groupId: string) {
    await connectDB();
    return Settlement.find({ group: groupId })
      .sort({ createdAt: -1 })
      .populate('paidBy', 'name email image')
      .populate('paidTo', 'name email image')
      .populate('createdBy', 'name email image')
      .lean();
  }
}

export const settlementService = new SettlementService();
