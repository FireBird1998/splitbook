import { withGroupMutation } from '@/lib/group-mutation';
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
import {
  createSettlementSchema,
  crossCurrencySettlementShape,
  type CreateSettlementInput,
} from '@splitbook/shared/validators/settlement';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import {
  assertCreateReplay,
  createRequestMetadata,
  makePendingActivity,
} from '@/lib/financial-write';
import { lockLedgerCurrency } from '@/lib/ledger-currency';
import User from '@/lib/models/User';
import { Types } from 'mongoose';
import { PERSON_FIELDS } from './person-fields';

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
    if (
      Object.keys(crossCurrencySettlementShape).some(
        (key) => data[key as keyof CreateSettlementInput] !== undefined,
      )
    )
      data = createSettlementSchema.parse(data);
    const crossCurrency = Object.fromEntries(
      Object.keys(crossCurrencySettlementShape).flatMap((key) => {
        const value = data[key as keyof CreateSettlementInput];
        return value === undefined ? [] : [[key, value]];
      }),
    );
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
        { path: 'paidBy', select: PERSON_FIELDS },
        { path: 'paidTo', select: PERSON_FIELDS },
        { path: 'createdBy', select: PERSON_FIELDS },
      ]);
    }
    // A retry of a payment recorded before the archive is confirmed above; nothing new is (#578).
    if (group.isArchived) throw new Error('GROUP_ARCHIVED');
    assertGroupCurrency(group, data.currency);
    if (data.paidCurrency) assertGroupCurrency(group, data.paidCurrency);

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
      ...(data.paidCurrency ? { amountMinor, ...crossCurrency } : {}),
      paidByName: names.find((person) => String(person._id) === paidBy)?.name,
      paidToName: names.find((person) => String(person._id) === data.paidTo)?.name,
    });

    let settlement;
    try {
      settlement = await withGroupMutation(
        groupId,
        async () => {
          // In the insert's own mutation, so a removal of the currency can't come in between (#721),
          // and both currencies rechecked under the same fence before either side is committed.
          await lockLedgerCurrency(groupId, data.currency);
          const current = await Group.findById(groupId);
          if (!current) throw new Error('FORBIDDEN');
          if (data.paidCurrency) assertGroupCurrency(current, data.paidCurrency);
          return Settlement.create({
            _id: settlementId,
            group: groupId,
            paidBy,
            paidTo: data.paidTo,
            amount: command.amount,
            amountMinor,
            moneyVersion: 1,
            currency: data.currency,
            ...crossCurrency,
            note: data.note,
            createdBy: userId,
            ...(requestKey ? { creationRequest: createRequestMetadata(requestKey, command) } : {}),
            pendingActivity: [event],
          });
        },
        { ledger: true },
      );
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
            { path: 'paidBy', select: PERSON_FIELDS },
            { path: 'paidTo', select: PERSON_FIELDS },
            { path: 'createdBy', select: PERSON_FIELDS },
          ]);
        }
      }
      throw err;
    }

    // Attempt recoverable publication before response preparation can fail after commit.
    await activityService.publishPending('settlements', settlement._id, settlement.pendingActivity);
    return settlement.populate([
      { path: 'paidBy', select: PERSON_FIELDS },
      { path: 'paidTo', select: PERSON_FIELDS },
      { path: 'createdBy', select: PERSON_FIELDS },
    ]);
  }

  /**
   * Get all settlements for a group.
   */
  async getGroupSettlements(groupId: string) {
    await connectDB();
    return Settlement.find({ group: groupId })
      .sort({ createdAt: -1 })
      .populate('paidBy', PERSON_FIELDS)
      .populate('paidTo', PERSON_FIELDS)
      .populate('createdBy', PERSON_FIELDS)
      .lean();
  }
}

export const settlementService = new SettlementService();
