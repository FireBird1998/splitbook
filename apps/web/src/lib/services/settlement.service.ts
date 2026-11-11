import { recordLedger, type LedgerRecording } from '@/lib/ledger-recording';
import connectDB from '@/lib/db';
import Settlement, { type ISettlementDocument } from '@/lib/models/Settlement';
import {
  assertSettlementAuthorization,
  assertSettlementMembers,
} from '@splitbook/shared/expense-validation';
import {
  createSettlementSchema,
  crossCurrencySettlementShape,
  type CreateSettlementInput,
} from '@splitbook/shared/validators/settlement';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { settlementDebtSnapshot } from './settlement-debt';
import User from '@/lib/models/User';
import { Types } from 'mongoose';
import { PERSON_FIELDS } from './person-fields';

export class SettlementService {
  /**
   * Record a new settlement.
   * Either the payer or the recipient may record it when authorized.
   */
  async create(groupId: string, data: CreateSettlementInput, userId: string, requestKey?: string) {
    const paidBy = data.paidBy || userId;
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
    // Admitted requests already passed positive-amount and exact-money validation.
    if (amountMinor <= 0) throw new Error('INVALID_MONEY');
    const command = {
      ...data,
      paidBy,
      amount: toMajorAmount(amountMinor, data.currency),
      note: data.note ?? '',
    };
    const settlementId = new Types.ObjectId();
    const {
      records: [settlement],
    } = await recordLedger({
      groupId,
      actorId: userId,
      model: Settlement,
      transactions: 'allow-standalone',
      compatibility: {
        membership: 'before-retry-and-at-commit',
      },
      command: () => command,
      retry: requestKey ? { key: requestKey } : undefined,
      currencies: [
        { currency: data.currency, rule: 'held-by-ledger' },
        ...(data.paidCurrency ? [{ currency: data.paidCurrency, rule: 'listed' as const }] : []),
      ],
      checkPeople(memberIds) {
        assertSettlementMembers(memberIds, paidBy, data.paidTo);
        assertSettlementAuthorization(userId, paidBy, data.paidTo);
      },
      async prepare(): ReturnType<LedgerRecording<ISettlementDocument>['prepare']> {
        const names = await User.find({ _id: { $in: [paidBy, data.paidTo] } })
          .select('name')
          .lean();
        return [
          {
            id: settlementId,
            build: async function singlePaymentCrossCurrencySnapshot() {
              // Same-currency payments don't require or record a Debt snapshot.
              const debtSnapshot = data.paidCurrency
                ? await settlementDebtSnapshot(
                    groupId,
                    data.currency,
                    paidBy,
                    data.paidTo,
                    amountMinor,
                  )
                : {};
              return {
                document: {
                  _id: settlementId,
                  paidBy: new Types.ObjectId(paidBy),
                  paidTo: new Types.ObjectId(data.paidTo),
                  amount: command.amount,
                  amountMinor,
                  moneyVersion: 1,
                  currency: data.currency,
                  ...crossCurrency,
                  ...debtSnapshot,
                  note: data.note,
                },
                activity: {
                  type: 'settlement_recorded',
                  metadata: {
                    settlementId: String(settlementId),
                    paidBy,
                    paidTo: data.paidTo,
                    amount: command.amount,
                    currency: data.currency,
                    ...(data.paidCurrency
                      ? { amountMinor, ...crossCurrency, ...debtSnapshot }
                      : {}),
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
          },
        ];
      },
    });
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
