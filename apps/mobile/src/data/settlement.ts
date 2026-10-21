import { z } from 'zod';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import {
  createSettlementSchema,
  crossCurrencySettlementReadShape,
  crossCurrencySettlementShape,
} from '@splitbook/shared/validators/settlement';
import {
  crossCurrencyRateKind,
  readCrossCurrencyEntry,
  suggestedRateText,
  type CrossCurrencyEntry,
  type RateSuggestion,
} from '@splitbook/shared/cross-currency-payment';
import { getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  calculateSettlementBatch,
  type SettlementBatchAmounts,
  type SettlementBatchItem,
  type SettlementBatchRate,
} from '@splitbook/shared/settlement-batch';
import { createSettlementBatchSchema } from '@splitbook/shared/validators/settlement-batch';
import type { CrossCurrencySettlementFields } from '@splitbook/shared/cross-currency-settlement';
import {
  parseAmountMinor,
  readStoredAmountMinor,
  sumMinorAmounts,
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
  /**
   * Several Debts settled at once (#734): each one's row as Record sends it, one Settlement for
   * each. `currency` is then the one currency they are paid in, and `amount` what they pay in all.
   */
  batch?: SettlementBatchItem[];
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
/** One Debt of a payment settling several at once, paid in another currency (#734). */
export interface BatchRate {
  rate: RateState;
  /** The member's own rate, as typed; null while it pays at the suggestion. */
  custom: string | null;
}
/**
 * Settle up (#734): one payment, in one currency, that clears every Debt between two people,
 * each at its own rate. A Debt in the paying currency needs none.
 */
export interface BatchPayment {
  paidBy: string;
  paidTo: string;
  /** The Debts it clears, in the Group's order, in major units, as the latest Balances show them. */
  debts: { currency: string; amount: number }[];
  /** The one currency it is paid in: one of the Debts'. */
  paidCurrency: string;
  /** Each Debt in another currency, by its currency. */
  rates: Record<string, BatchRate>;
}
/** Record's reason while a Debt of a settle-up has no rate yet (#734). */
export const enterBatchRate = (currency: string) =>
  `Enter the rate for the ${currency} Debt to record it.`;
/** One Debt of a settle-up, as the sheet shows it. */
export interface BatchLine {
  currency: string;
  debtMinor: number;
  /** What it pays, in the paying currency; null until its rate is known. */
  paidMinor: number | null;
  /** The rate it is paid at, as a decimal; null in the paying currency, or until it is known. */
  rate: string | null;
  kind: 'same' | CrossCurrencySettlementFields['rateKind'] | null;
}
/**
 * A settle-up read by the shared rules: each Debt's line, and the payment's rows and total once
 * every rate is known (`calculateSettlementBatch`); else what Record waits for.
 */
export function readBatchPayment({ debts, paidCurrency, rates }: BatchPayment) {
  let waiting: string | null = null;
  const choices: Record<string, SettlementBatchRate> = {};
  const lines = debts.map(({ currency, amount }): BatchLine => {
    const debtMinor = parseAmountMinor(amount, currency);
    if (currency === paidCurrency)
      return { currency, debtMinor, paidMinor: debtMinor, rate: null, kind: 'same' };
    const unknown = { currency, debtMinor, paidMinor: null, rate: null, kind: null };
    const { rate, custom } = rates[currency] ?? { rate: { status: 'loading' }, custom: null };
    if (rate.status === 'loading' || rate.status === 'unreachable') {
      waiting ??= rate.status === 'loading' ? recordWaitsForRate : recordNeedsConnection;
      return unknown;
    }
    const suggestion = rate.status === 'ready' ? rate.suggestion : null;
    const typed = custom?.trim() ? custom : suggestion && suggestedRateText(suggestion.rate);
    if (!typed) {
      waiting ??= enterBatchRate(currency);
      return unknown;
    }
    const pair = { currency, paidCurrency };
    const places = getCurrencyPrecision(currency);
    const reading = readCrossCurrencyEntry(
      {
        cleared: toMajorAmount(debtMinor, currency).toFixed(places),
        rate: typed,
        paid: '',
        drivers: ['rate', 'cleared'],
      },
      pair,
    );
    if (reading.status !== 'valid') {
      waiting ??= reading.status === 'invalid' ? reading.message : enterBatchRate(currency);
      return unknown;
    }
    const plain = typed.trim().replaceAll(',', '').replace(/\.$/, '');
    const kind = crossCurrencyRateKind(pair, reading.amounts, suggestion);
    const provenance = suggestion && {
      suggestedRate: suggestion.rate,
      rateSource: suggestion.source,
      rateAsOf: suggestion.asOf,
      rateFetchedAt: suggestion.fetchedAt,
    };
    choices[currency] =
      !provenance || kind === 'entered'
        ? { rateKind: 'entered', rate: plain }
        : kind === 'suggested'
          ? { rateKind: 'suggested', ...provenance }
          : { rateKind: 'custom', rate: plain, ...provenance };
    return {
      currency,
      debtMinor,
      paidMinor: reading.amounts.amountPaidMinor,
      rate: kind === 'suggested' && suggestion ? suggestion.rate : plain,
      kind,
    };
  });
  let amounts: SettlementBatchAmounts | null = null;
  if (!waiting)
    try {
      amounts = calculateSettlementBatch({
        debts: lines.map(({ currency, debtMinor }) => ({ currency, amountMinor: debtMinor })),
        paidCurrency,
        rates: choices,
      });
    } catch {
      waiting = 'This payment can’t be worked out from these rates. Check them.';
    }
  return { lines, amounts, waiting };
}
/** A settle-up's body: the payment's people, its currency and one row for each Debt. */
export function batchBody({ paidBy, paidTo, currency, batch }: SettlementDraft) {
  return JSON.stringify(
    createSettlementBatchSchema.parse({
      paidBy,
      paidTo,
      paidCurrency: currency,
      settlements: batch,
    }),
  );
}
/** Whether a stored body is a settle-up's, sent to /settlements/batch (#734). */
export const isBatchBody = (body: string) => {
  try {
    return Array.isArray(Object(JSON.parse(body)).settlements);
  } catch {
    return false;
  }
};
/** What a settle-up's rows pay in all, in the paying currency's minor units. */
const paidInAll = (rows: SettlementBatchItem[]) =>
  sumMinorAmounts(
    rows.map((row) => row.amountPaidMinor ?? parseAmountMinor(row.amount, row.currency)),
  );
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
  /** Settle up: every Debt between the two, in several currencies at once (#734). */
  all?: boolean;
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
  /** Several Debts settled at once while the member enters it; null for one (#734). */
  batch: BatchPayment | null;
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
  batch: null,
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
  if (isBatchBody(stored.body)) {
    const batch = createSettlementBatchSchema
      .safeExtend({ paidBy: objectId, paidTo: objectId })
      .parse(JSON.parse(stored.body));
    if (!canRecordSettlement(accountId, batch.paidBy, batch.paidTo))
      throw new Error('Unexpected Settlement account');
    return {
      attempt: { key: stored.key, body: stored.body },
      draft: {
        paidBy: batch.paidBy,
        paidTo: batch.paidTo,
        currency: batch.paidCurrency,
        amount: String(toMajorAmount(paidInAll(batch.settlements), batch.paidCurrency)),
        note: '',
        batch: batch.settlements,
      } as SettlementDraft,
    };
  }
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

/** A settle-up's reply: each Settlement recorded as it was sent, in order, or it isn't trusted. */
export function parseRecordedBatch(value: unknown, groupId: string, body: string) {
  const saved = z
    .object({
      status: z.literal(201),
      data: z.object({
        paidCurrency: z.string(),
        totalPaidMinor: z.number().int(),
        settlements: z.array(record),
      }),
    })
    .parse(value).data;
  const expected = createSettlementBatchSchema
    .safeExtend({ paidBy: objectId })
    .parse(JSON.parse(body));
  if (
    saved.paidCurrency !== expected.paidCurrency ||
    saved.totalPaidMinor !== paidInAll(expected.settlements) ||
    saved.settlements.length !== expected.settlements.length ||
    saved.settlements.some((row, index) => {
      const sent = expected.settlements[index]!;
      return (
        row.group !== groupId ||
        row.paidBy.id !== expected.paidBy ||
        row.paidTo.id !== expected.paidTo ||
        row.currency !== sent.currency ||
        readStoredAmountMinor(row) !== parseAmountMinor(sent.amount, sent.currency) ||
        paidSideFields.some((field) =>
          field === 'paidCurrency'
            ? row.paidCurrency !==
              (sent.amountPaidMinor === undefined ? undefined : expected.paidCurrency)
            : row[field] !== sent[field],
        )
      );
    })
  )
    throw new Error('Unexpected recorded payment');
  return saved;
}
