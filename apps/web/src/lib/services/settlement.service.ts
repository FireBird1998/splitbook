import connectDB from '@/lib/db';
import { ensureLedgerWriteIndexes } from '@/lib/ledger-indexes';
import Group from '@/lib/models/Group';
import Settlement from '@/lib/models/Settlement';
import { activityService } from './activity.service';
import {
  assertGroupCurrency,
  assertSettlementAuthorization,
  assertSettlementMembers,
} from '@splitbook/shared/expense-validation';
import type { CreateSettlementInput } from '@splitbook/shared/validators/settlement';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import {
  assertCreateReplay,
  createRequestMetadata,
  makePendingActivity,
} from '@/lib/financial-write';
import { lockLedgerCurrency } from '@/lib/ledger-currency';
import User from '@/lib/models/User';
import { Types } from 'mongoose';

export class SettlementService {
  /**
   * Record a new settlement.
   * Either the payer or the recipient may record it when authorized.
   */
  async create(groupId: string, data: CreateSettlementInput, userId: string, requestKey?: string) {
    await connectDB();
    await ensureLedgerWriteIndexes();

    const group = await Group.findById(groupId);
    if (!group) throw new Error('Group not found');

    const memberIds = new Set(group.members.map((member) => member.user.toString()));
    const paidBy = data.paidBy || userId;

    if (!memberIds.has(userId)) throw new Error('FORBIDDEN');

    assertSettlementMembers(memberIds, paidBy, data.paidTo);
    assertSettlementAuthorization(userId, paidBy, data.paidTo);
    const amountMinor = parseAmountMinor(data.amount, data.currency);
    if (amountMinor <= 0) throw new Error('INVALID_MONEY');
    const command = {
      ...data,
      paidBy,
      amount: toMajorAmount(amountMinor, data.currency),
      note: data.note ?? '',
    };
    const replay = requestKey
      ? await Settlement.findOne({
          group: groupId,
          createdBy: userId,
          'creationRequest.key': requestKey,
        }).select('+creationRequest +pendingActivity')
      : null;
    if (replay) {
      assertCreateReplay(replay.creationRequest!, command);
      await activityService.publishPending('settlements', replay._id, replay.pendingActivity);
      return replay.populate([
        { path: 'paidBy', select: 'name email image' },
        { path: 'paidTo', select: 'name email image' },
        { path: 'createdBy', select: 'name email image' },
      ]);
    }
    assertGroupCurrency(group.defaultCurrency, data.currency);
    await lockLedgerCurrency(groupId, data.currency);

    const settlementId = new Types.ObjectId();
    const names = await User.find({ _id: { $in: [paidBy, data.paidTo] } })
      .select('name')
      .lean();
    const event = makePendingActivity(groupId, 'settlement_recorded', userId, {
      settlementId: String(settlementId),
      paidBy,
      paidTo: data.paidTo,
      amount: command.amount,
      currency: data.currency,
      paidByName: names.find((person) => String(person._id) === paidBy)?.name,
      paidToName: names.find((person) => String(person._id) === data.paidTo)?.name,
    });

    let settlement;
    try {
      settlement = await Settlement.create({
        _id: settlementId,
        group: groupId,
        paidBy,
        paidTo: data.paidTo,
        amount: command.amount,
        amountMinor,
        moneyVersion: 1,
        currency: data.currency,
        note: data.note,
        createdBy: userId,
        ...(requestKey ? { creationRequest: createRequestMetadata(requestKey, command) } : {}),
        pendingActivity: [event],
      });
    } catch (err) {
      if (requestKey && (err as { code?: number }).code === 11000) {
        const existing = await Settlement.findOne({
          group: groupId,
          createdBy: userId,
          'creationRequest.key': requestKey,
        }).select('+creationRequest +pendingActivity');
        if (existing) {
          assertCreateReplay(existing.creationRequest!, command);
          await activityService.publishPending(
            'settlements',
            existing._id,
            existing.pendingActivity,
          );
          return existing.populate([
            { path: 'paidBy', select: 'name email image' },
            { path: 'paidTo', select: 'name email image' },
            { path: 'createdBy', select: 'name email image' },
          ]);
        }
      }
      throw err;
    }

    const populated = await settlement.populate([
      { path: 'paidBy', select: 'name email image' },
      { path: 'paidTo', select: 'name email image' },
      { path: 'createdBy', select: 'name email image' },
    ]);

    await activityService.publishPending('settlements', settlement._id, settlement.pendingActivity);

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
