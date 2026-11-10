import { Refusal } from '@splitbook/shared/refusals';
import { recordLedger, type LedgerRecording } from '@/lib/ledger-recording';
import Settlement, { type ISettlementDocument } from '@/lib/models/Settlement';
import User from '@/lib/models/User';
import { Types } from 'mongoose';
import {
  createSettlementBatchSchema,
  type CreateSettlementBatchInput,
} from '@splitbook/shared/validators/settlement-batch';
import {
  assertSettlementAuthorization,
  assertSettlementMembers,
} from '@splitbook/shared/expense-validation';
import { parseAmountMinor, sumMinorAmounts, toMajorAmount } from '@splitbook/shared/exact-money';
import { settlementDebtSnapshot } from './settlement-debt';
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
  const ids = rows.map(() => new Types.ObjectId());
  const saved = await recordLedger({
    groupId,
    actorId: userId,
    model: Settlement,
    transactions: { required: new Refusal('SETTLEMENT_TRANSACTIONS_REQUIRED') },
    compatibility: { membership: 'before-retry-and-at-commit' },
    retry: { key: requestKey, command, receipt: 'ordered-records', atCommit: true },
    currencies: [],
    prepareAt: 'commit',
    async prepareResponseRecord(row) {
      await row.populate([
        { path: 'paidBy', select: PERSON_FIELDS },
        { path: 'paidTo', select: PERSON_FIELDS },
        { path: 'createdBy', select: PERSON_FIELDS },
      ]);
    },
    checkPeople(members) {
      assertSettlementMembers(members, paidBy, data.paidTo);
      assertSettlementAuthorization(userId, paidBy, data.paidTo);
    },
    async prepare(): ReturnType<LedgerRecording<ISettlementDocument>['prepare']> {
      const names = await User.find({ _id: { $in: [paidBy, data.paidTo] } })
        .select('name')
        .lean();
      return rows.map((row, index) => ({
        id: ids[index],
        currencies: [
          { currency: row.currency, rule: 'held-by-ledger' },
          { currency: data.paidCurrency, rule: 'listed' },
        ],
        async build() {
          const amountMinor = parseAmountMinor(row.amount, row.currency);
          const snapshot = await settlementDebtSnapshot(
            groupId,
            row.currency,
            paidBy,
            data.paidTo,
            amountMinor,
            { requireDebt: true },
          );
          return {
            document: {
              ...row,
              paidBy: new Types.ObjectId(paidBy),
              paidTo: new Types.ObjectId(data.paidTo),
              amountMinor,
              moneyVersion: 1,
              ...snapshot,
            },
            activity: {
              type: 'settlement_recorded',
              metadata: {
                ...row,
                note: undefined,
                settlementId: String(ids[index]),
                batchId: String(ids[0]),
                batchSize: rows.length,
                amountMinor,
                ...snapshot,
                paidByName: names.find((person) => String(person._id) === paidBy)?.name,
                paidToName: names.find((person) => String(person._id) === data.paidTo)?.name,
              },
              alert: {
                kind: 'settlement_recorded',
                involved: [paidBy, data.paidTo],
                switch: 'payments',
              },
            },
          };
        },
      }));
    },
  });
  return { paidCurrency: data.paidCurrency, totalPaidMinor, settlements: saved };
}
