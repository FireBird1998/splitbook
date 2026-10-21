import { z } from 'zod';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import {
  createSettlementSchema,
  crossCurrencySettlementReadShape,
  crossCurrencySettlementShape,
} from '@splitbook/shared/validators/settlement';
import type { CrossCurrencyEntry, RateSuggestion } from '@splitbook/shared/cross-currency-payment';
import type { CrossCurrencySettlementFields } from '@splitbook/shared/cross-currency-settlement';
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
  /** The Debt's currency: `amount` is the amount cleared, in it. */
  currency: string;
  amount: string;
  note: string;
  /**
   * Paid in another currency (#728): what was paid, and at what rate, as Record sends it. An
   * unconfirmed payment keeps it, and Retry sends it unchanged; while the member enters it, the
   * sheet's `crossCurrency` holds it.
   */
  paid?: CrossCurrencySettlementFields;
}
/** Record's reason, and the Balances', while the phone has no connection. */
export const recordNeedsConnection = 'Recording a payment needs a connection.';
/** Record's reason while the sheet looks up a suggested rate (#728). */
export const recordWaitsForRate = 'Record is available once a suggested rate is looked up.';
/** Record's reason while a payment in another currency has a field left to enter (#728). */
export const enterRateOrPaid = 'Enter the rate or the amount paid to record it.';
/** What the sheet knows of a suggested rate between the Debt's currency and another (#728). */
export type RateState =
  | { status: 'loading' }
  | { status: 'ready'; suggestion: RateSuggestion }
  /** The rate service has no suggestion, `reason` saying why; null when its read failed. */
  | { status: 'none'; reason: string | null }
  /** The phone couldn't reach Splitbook: the rate, and recording, wait for a connection. */
  | { status: 'unreachable' };
/** A Debt the member is paying in another of the Group's currencies (#728). */
export interface CrossCurrencyPayment {
  paidCurrency: string;
  /** The amount cleared, the rate and the amount paid, as typed or worked out. */
  entry: CrossCurrencyEntry;
  rate: RateState;
}
const paidSideFields = Object.keys(
  crossCurrencySettlementShape,
) as (keyof typeof crossCurrencySettlementShape)[];
/** A payment's paid side and rate, when it was paid in another currency. */
function paidSideOf(value: Partial<CrossCurrencySettlementFields>) {
  if (value.amountPaidMinor === undefined) return undefined;
  return Object.fromEntries(
    paidSideFields.flatMap((field) => (value[field] === undefined ? [] : [[field, value[field]]])),
  ) as unknown as CrossCurrencySettlementFields;
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
  ...crossCurrencySettlementReadShape,
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
  /** Group refusal keeps a stored payment blocked until leaving or Discard. */
  accessLost?: boolean;
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
  /** The Debt paid in another of the Group's currencies; null in its own (#728). */
  crossCurrency: CrossCurrencyPayment | null;
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
  crossCurrency: null,
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
/** The payment's body: the amount cleared, and a payment in another currency's paid side. */
export function settlementBody({ paid, ...draft }: SettlementDraft) {
  const amount = toMajorAmount(parseAmountMinor(draft.amount, draft.currency), draft.currency);
  return JSON.stringify(
    createSettlementSchema
      .safeExtend({ paidBy: objectId, paidTo: objectId })
      .parse({ ...draft, amount, note: draft.note.trim(), ...paid }),
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
  const paid = paidSideOf(payload);
  return {
    attempt: { key: stored.key, body: stored.body },
    draft: {
      paidBy: payload.paidBy,
      paidTo: payload.paidTo,
      currency: payload.currency,
      amount: String(payload.amount),
      note: payload.note ?? '',
      ...(paid ? { paid } : {}),
    },
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
    saved.note !== (expected.note ?? '') ||
    // A payment in another currency is recorded with the paid side and rate it was sent with.
    paidSideFields.some((field) => saved[field] !== expected[field])
  )
    throw new Error('Unexpected recorded payment');
  return saved;
}
