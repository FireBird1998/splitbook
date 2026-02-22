import connectDB from '@/lib/db';
import Settlement from '@/lib/models/Settlement';
import { activityService } from './activity.service';
import type { CreateSettlementInput } from '@/lib/validators/settlement.validator';

export class SettlementService {
  /**
   * Record a new settlement.
   */
  async create(groupId: string, data: CreateSettlementInput, userId: string) {
    await connectDB();

    const settlement = await Settlement.create({
      group: groupId,
      paidBy: userId,
      paidTo: data.paidTo,
      amount: data.amount,
      currency: data.currency,
      note: data.note,
      createdBy: userId,
    });

    // Log activity
    await activityService.log(groupId, 'settlement_recorded', userId, {
      settlementId: settlement._id.toString(),
      paidTo: data.paidTo,
      amount: data.amount,
      currency: data.currency,
    });

    return settlement.populate([
      { path: 'paidBy', select: 'name email image' },
      { path: 'paidTo', select: 'name email image' },
    ]);
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
      .lean();
  }
}

export const settlementService = new SettlementService();
