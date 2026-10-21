import { z } from 'zod/v4';
import { CURRENCY_CODES } from '../currency';
import { MAX_EXPENSE_AMOUNT, parseAmountMinor } from '../exact-money';
import { calculateCrossCurrencySettlement, rateFraction } from '../cross-currency-settlement';

const rate = z.string().refine((value) => {
  try {
    rateFraction(value);
    return true;
  } catch {
    return false;
  }
}, 'Enter a positive rate with at most 18 decimal places');

/** Shared wire fields: absent together on a same-currency Settlement. */
export const crossCurrencySettlementShape = {
  amountPaidMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  paidCurrency: z.enum(CURRENCY_CODES as [string, ...string[]]).optional(),
  appliedRate: rate.optional(),
  suggestedRate: rate.optional(),
  rateSource: z.enum(['frankfurter', 'exchange-rate-api', 'mixed']).optional(),
  rateAsOf: z.iso.date().optional(),
  rateFetchedAt: z.iso.datetime({ offset: true }).optional(),
  rateKind: z.enum(['suggested', 'custom', 'entered']).optional(),
};

export const createSettlementSchema = z
  .object({
    ...crossCurrencySettlementShape,
    /** Who paid. Defaults to the recording user when omitted. */
    paidBy: z.string().min(1).optional(),
    paidTo: z.string().min(1, 'Recipient is required'),
    amount: z.number().positive('Amount must be positive').max(MAX_EXPENSE_AMOUNT),
    currency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
      message: 'Invalid currency code',
    }),
    note: z.string().max(500).trim().optional(),
  })
  .superRefine((data, context) => {
    if (!CURRENCY_CODES.includes(data.currency)) return;
    try {
      const amountClearedMinor = parseAmountMinor(data.amount, data.currency);
      const cross = Object.keys(crossCurrencySettlementShape).some(
        (key) => data[key as keyof typeof data] !== undefined,
      );
      if (!cross) return;
      if (
        data.amountPaidMinor === undefined ||
        !data.paidCurrency ||
        !data.appliedRate ||
        !data.rateKind
      )
        throw new Error(
          'A cross-currency payment needs the paid amount, paid currency, applied rate and rate kind',
        );
      const computed = calculateCrossCurrencySettlement({
        currency: data.currency,
        paidCurrency: data.paidCurrency,
        amountClearedMinor,
        amountPaidMinor: data.amountPaidMinor,
      });
      const supplied = rateFraction(data.appliedRate);
      const derived = rateFraction(computed.appliedRate);
      if (supplied.numerator * derived.denominator !== derived.numerator * supplied.denominator)
        throw new Error('The applied rate must be derived from the two recorded amounts');
      const provenance = [data.suggestedRate, data.rateSource, data.rateAsOf, data.rateFetchedAt];
      if (data.rateKind === 'entered') {
        if (provenance.some((value) => value !== undefined))
          throw new Error('An entered rate has no suggested rate or source');
      } else {
        if (provenance.some((value) => value === undefined))
          throw new Error('Keep the suggested rate, source, as-of date and fetch time together');
        if (
          data.rateKind === 'suggested' &&
          calculateCrossCurrencySettlement({
            currency: data.currency,
            paidCurrency: data.paidCurrency,
            amountClearedMinor,
            rate: data.suggestedRate!,
          }).amountPaidMinor !== data.amountPaidMinor
        )
          throw new Error('The paid amount must match the suggested rate after rounding');
      }
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: error instanceof Error ? error.message : 'Invalid amount',
      });
    }
  });

export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
