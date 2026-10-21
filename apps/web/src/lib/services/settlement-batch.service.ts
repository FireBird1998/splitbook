import connectDB from '@/lib/db';
import { supportsGroupTransactions, withGroupMutation } from '@/lib/group-mutation';
import { ensureLedgerWriteIndexes } from '@/lib/ledger-indexes';
import {
  assertCreateReplay,
  createRequestMetadata,
  makePendingActivity,
} from '@/lib/financial-write';
import Group from '@/lib/models/Group';
import Settlement from '@/lib/models/Settlement';
import User from '@/lib/models/User';
import { Types } from 'mongoose';
import {
  createSettlementBatchSchema,
  type CreateSettlementBatchInput,
} from '@splitbook/shared/validators/settlement-batch';
import {
  assertGroupCurrency,
  assertSettlementAuthorization,
  assertSettlementMembers,
} from '@splitbook/shared/expense-validation';
import { parseAmountMinor, sumMinorAmounts, toMajorAmount } from '@splitbook/shared/exact-money';
import { assertSettlementCurrencies } from './settlement.service';
import { settlementDebtSnapshot } from './settlement-debt';
import { activityService } from './activity.service';
import { PERSON_FIELDS } from './person-fields';

/** One member-started payment; the first Settlement holds its whole-request retry identity. */
export async function createSettlementBatch(
  groupId: string,
  input: CreateSettlementBatchInput,
  userId: string,
  requestKey: string,
) {
  const data = createSettlementBatchSchema.parse(input);
  const paidBy = data.paidBy ?? userId;
  const rows = data.settlements.map((row) => ({
    ...row,
    paidBy,
    paidTo: data.paidTo,
    note: row.note ?? '',
    amount: toMajorAmount(parseAmountMinor(row.amount, row.currency), row.currency),
    ...(row.currency !== data.paidCurrency ? { paidCurrency: data.paidCurrency } : {}),
  }));
  const command = { kind: 'settlement-batch', paidCurrency: data.paidCurrency, settlements: rows };
  const totalPaidMinor = sumMinorAmounts(
    rows.map((row) => row.amountPaidMinor ?? parseAmountMinor(row.amount, row.currency)),
  );
  await connectDB();
  await ensureLedgerWriteIndexes();
  const authorize = async () => {
    const group = await Group.findById(groupId);
    if (!group || !group.members.some((member) => String(member.user) === userId))
      throw new Error('FORBIDDEN');
    assertSettlementMembers(
      new Set(group.members.map((member) => String(member.user))),
      paidBy,
      data.paidTo,
    );
    assertSettlementAuthorization(userId, paidBy, data.paidTo);
    return group;
  };
  await authorize();
  const replay = async () => {
    const first = await Settlement.findOne({
      group: groupId,
      createdBy: userId,
      'creationRequest.key': requestKey,
    }).select('+creationRequest +batchSettlementIds');
    if (!first) return null;
    assertCreateReplay(first.creationRequest!, command);
    if (!first.batchSettlementIds?.length) throw new Error('IDEMPOTENCY_CONFLICT');
    const saved = await Settlement.find({
      group: groupId,
      _id: { $in: first.batchSettlementIds },
    }).select('+pendingActivity');
    if (saved.length !== first.batchSettlementIds.length)
      throw new Error('Incomplete stored Settlement batch');
    return first.batchSettlementIds.map((id) => saved.find((row) => row._id.equals(id))!);
  };
  const respond = async (saved: NonNullable<Awaited<ReturnType<typeof replay>>>) => {
    // Publication follows the complete ledger commit. Each row has its own recoverable outbox.
    for (const row of saved) {
      await activityService.publishPending('settlements', row._id, row.pendingActivity);
      await row.populate([
        { path: 'paidBy', select: PERSON_FIELDS },
        { path: 'paidTo', select: PERSON_FIELDS },
        { path: 'createdBy', select: PERSON_FIELDS },
      ]);
    }
    return { paidCurrency: data.paidCurrency, totalPaidMinor, settlements: saved };
  };
  const existing = await replay();
  if (existing) return respond(existing);
  // Unlike a single legacy save, a batch can never fall back to non-transactional writes.
  if (!(await supportsGroupTransactions())) throw new Error('SETTLEMENT_TRANSACTIONS_REQUIRED');
  const ids = rows.map(() => new Types.ObjectId());
  const saved = await withGroupMutation(
    groupId,
    async (session) => {
      if (!session) throw new Error('SETTLEMENT_TRANSACTIONS_REQUIRED');
      const group = await authorize();
      // A competing request may have committed while this one waited on the Group fence.
      const concurrent = await replay();
      if (concurrent) return concurrent;
      assertGroupCurrency(group, data.paidCurrency);
      await Group.updateOne(
        { _id: groupId },
        { $set: { currencyLocked: true } },
        { timestamps: false },
      );
      const names = await User.find({ _id: { $in: [paidBy, data.paidTo] } })
        .select('name')
        .lean();
      const result = [];
      for (const [index, row] of rows.entries()) {
        await assertSettlementCurrencies(groupId, group, row);
        const amountMinor = parseAmountMinor(row.amount, row.currency);
        const snapshot = await settlementDebtSnapshot(
          groupId,
          row.currency,
          paidBy,
          data.paidTo,
          amountMinor,
          { requireDebt: true },
        );
        const event = makePendingActivity(groupId, 'settlement_recorded', userId, {
          ...row,
          note: undefined,
          settlementId: String(ids[index]),
          amountMinor,
          ...snapshot,
          paidByName: names.find((person) => String(person._id) === paidBy)?.name,
          paidToName: names.find((person) => String(person._id) === data.paidTo)?.name,
        });
        result.push(
          await Settlement.create({
            ...row,
            _id: ids[index],
            group: groupId,
            createdBy: userId,
            amountMinor,
            moneyVersion: 1,
            ...snapshot,
            ...(index === 0
              ? {
                  creationRequest: createRequestMetadata(requestKey, command),
                  batchSettlementIds: ids,
                }
              : {}),
            pendingActivity: [event],
          }),
        );
      }
      return result;
    },
    { ledger: true },
  );
  return respond(saved);
}
