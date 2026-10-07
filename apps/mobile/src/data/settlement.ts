import { z } from 'zod';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import { createSettlementSchema } from '@splitbook/shared/validators/settlement';
import {
  parseAmountMinor,
  readStoredAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import { objectId } from './dto';
import {
  amountError,
  correctionSummary,
  emptyFormValidation,
  type FormValidation,
} from './field-feedback';
import type { GroupCurrencyBalance, MobileGroup } from './types';

export interface SettlementDraft {
  paidBy: string;
  paidTo: string;
  currency: string;
  amount: string;
  note: string;
}
export const settlementFields = ['amount', 'note'] as const;
export type SettlementField = (typeof settlementFields)[number];
export type SettlementFieldErrors = Partial<Record<SettlementField, string>>;
export const settlementFieldLabels: Record<SettlementField, string> = {
  amount: 'Amount',
  note: 'Note',
};
/**
 * Local corrections before review. Payer, recipient and currency come from the chosen
 * suggestion and never change here; the server re-validates the same shared rules.
 */
export function validateSettlementDraft(draft: SettlementDraft): SettlementFieldErrors {
  const errors: SettlementFieldErrors = {};
  const amount = amountError(draft.amount, draft.currency);
  if (amount) errors.amount = amount;
  if (draft.note.trim().length > 500) errors.note = 'Keep the note to 500 characters or fewer.';
  return errors;
}
export const settlementCorrectionSummary = (errors: SettlementFieldErrors) =>
  correctionSummary(settlementFields, settlementFieldLabels, errors, 'reviewing');
export interface SettlementAttempt {
  key: string;
  body: string;
}
/**
 * A payment stored on this device whose response was lost. Balances offers it whatever the
 * suggestions say; `draft` is null when the stored record can't be read.
 */
export interface PendingPayment {
  groupId: string;
  draft: SettlementDraft | null;
}
const person = z
  .union([objectId, z.object({ _id: objectId, name: z.string().optional() }), z.null()])
  .transform((value) => ({
    id: typeof value === 'string' ? value : (value?._id ?? null),
    name: typeof value === 'object' && value ? (value.name ?? 'Former member') : 'Former member',
  }));
const record = z.object({
  _id: objectId,
  group: objectId,
  paidBy: person,
  paidTo: person,
  amount: z.number(),
  amountMinor: z.number().int().optional(),
  moneyVersion: z.number().int().optional(),
  currency: z.string(),
  note: z.string().default(''),
  createdAt: z.iso.datetime({ offset: true }),
});
export type SettlementRecord = z.infer<typeof record>;
/**
 * The suggested payment chosen on Balances, which the sheet checks against the latest balances
 * (#334). `shown` is that suggestion's amount as Balances showed it, when they did: the sheet
 * shows it, locked, until the check confirms it or can't run. Nothing is ever recorded from it;
 * Try again checks this payment again.
 */
export interface SettlementChoice {
  paidBy: string;
  paidTo: string;
  currency: string;
  shown: number | null;
}
export interface SettlementState {
  groupId: string | null;
  group: MobileGroup | null;
  balances: GroupCurrencyBalance[];
  status:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'editing'
    | 'review'
    | 'saving'
    | 'uncertain'
    | 'blocked'
    | 'error';
  draft: SettlementDraft | null;
  attempt: SettlementAttempt | null;
  /** The payment chosen on Balances; null when the sheet opened for an unconfirmed payment. */
  chosen: SettlementChoice | null;
  /**
   * The Group's people by id, as this phone knew them when the sheet opened: its members, and
   * anyone its Balances named. They name payer and recipient until the check reads the Group,
   * which alone names them from then on (#334).
   */
  known: Record<string, string>;
  suggested: number | null;
  acknowledged: boolean;
  message: string | null;
  validation: FormValidation<SettlementField>;
}
export const emptySettlement = (): SettlementState => ({
  groupId: null,
  group: null,
  balances: [],
  status: 'idle',
  draft: null,
  attempt: null,
  chosen: null,
  known: {},
  suggested: null,
  acknowledged: false,
  message: null,
  validation: emptyFormValidation(),
});
export function parseSettlementHistory(value: unknown, groupId: string) {
  const records = z.object({ status: z.literal(200), data: z.array(record) }).parse(value).data;
  for (const item of records) {
    if (item.group !== groupId) throw new Error('Unexpected Settlement Group');
    readStoredAmountMinor(item);
  }
  return records;
}
export function settlementBody(draft: SettlementDraft) {
  const amount = toMajorAmount(parseAmountMinor(draft.amount, draft.currency), draft.currency);
  return JSON.stringify(
    createSettlementSchema
      .safeExtend({ paidBy: objectId, paidTo: objectId })
      .parse({ ...draft, amount }),
  );
}
export function parseSettlementAttempt(value: unknown, accountId: string, groupId: string) {
  const stored = z
    .object({
      version: z.literal(1),
      accountId: z.literal(accountId),
      groupId: z.literal(groupId),
      key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
      body: z.string(),
    })
    .parse(value);
  const payload = createSettlementSchema
    .safeExtend({ paidBy: objectId, paidTo: objectId })
    .parse(JSON.parse(stored.body));
  if (!canRecordSettlement(accountId, payload.paidBy, payload.paidTo))
    throw new Error('Unexpected Settlement account');
  return {
    attempt: { key: stored.key, body: stored.body },
    draft: { ...payload, amount: String(payload.amount), note: payload.note ?? '' },
  };
}
export function settlementSuggestion(balances: GroupCurrencyBalance[], draft: SettlementDraft) {
  return (
    balances
      .find((b) => b.currency === draft.currency)
      ?.debts.find((d) => d.from.id === draft.paidBy && d.to.id === draft.paidTo)?.amount ?? 0
  );
}

export function parseRecordedSettlement(value: unknown, groupId: string, body: string) {
  const saved = z.object({ status: z.literal(201), data: record }).parse(value).data;
  const expected = createSettlementSchema.safeExtend({ paidBy: objectId }).parse(JSON.parse(body));
  if (
    saved.group !== groupId ||
    saved.paidBy.id !== expected.paidBy ||
    saved.paidTo.id !== expected.paidTo ||
    saved.currency !== expected.currency ||
    readStoredAmountMinor(saved) !== parseAmountMinor(expected.amount, expected.currency) ||
    saved.note !== (expected.note ?? '')
  )
    throw new Error('Unexpected recorded payment');
  return saved;
}
