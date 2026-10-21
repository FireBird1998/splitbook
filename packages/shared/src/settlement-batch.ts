import {
  calculateCrossCurrencySettlement,
  type CrossCurrencySettlementFields,
} from './cross-currency-settlement';
import {
  MoneyValidationError,
  parseAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';
import { createSettlementSchema, type CreateSettlementInput } from './validators/settlement';

export type SettlementBatchItem = Omit<CreateSettlementInput, 'paidBy' | 'paidTo'>;
type SuggestedRate = Required<
  Pick<CrossCurrencySettlementFields, 'suggestedRate' | 'rateSource' | 'rateAsOf' | 'rateFetchedAt'>
>;
export type SettlementBatchRate =
  | { rateKind: 'entered'; rate: string }
  | (SuggestedRate & { rateKind: 'suggested' })
  | (SuggestedRate & { rateKind: 'custom'; rate: string });
export interface SettlementBatchCalculation {
  debts: readonly { currency: string; amountMinor: number }[];
  paidCurrency: string;
  /** Keyed by the cleared currency; no rate is needed for the paying currency itself. */
  rates: Readonly<Record<string, SettlementBatchRate | undefined>>;
}
export interface SettlementBatchAmounts {
  paidCurrency: string;
  totalPaidMinor: number;
  settlements: SettlementBatchItem[];
}
function invalid(message: string): never {
  throw new MoneyValidationError('INVALID_SETTLEMENT_BATCH', message);
}
/** Round each payment independently, then add only paid-currency minor units. Never net currencies. */
export function calculateSettlementBatch(
  input: SettlementBatchCalculation,
): SettlementBatchAmounts {
  if (input.debts.length < 1 || input.debts.length > 32) invalid('Choose between 1 and 32 Debts');
  const seen = new Set<string>();
  const settlements = input.debts.map(({ currency, amountMinor }) => {
    if (seen.has(currency)) invalid('Choose each cleared currency once');
    seen.add(currency);
    const amount = toMajorAmount(amountMinor, currency);
    let fields: Partial<CrossCurrencySettlementFields> = {};
    if (currency !== input.paidCurrency) {
      const choice = input.rates[currency];
      if (!choice) invalid(`Enter a rate for ${currency}`);
      const calculated = calculateCrossCurrencySettlement({
        currency,
        paidCurrency: input.paidCurrency,
        amountClearedMinor: amountMinor,
        rate: choice.rateKind === 'suggested' ? choice.suggestedRate : choice.rate,
      });
      fields = {
        paidCurrency: input.paidCurrency,
        amountPaidMinor: calculated.amountPaidMinor,
        appliedRate: calculated.appliedRate,
        rateKind: choice.rateKind,
        ...(choice.rateKind !== 'entered'
          ? {
              suggestedRate: choice.suggestedRate,
              rateSource: choice.rateSource,
              rateAsOf: choice.rateAsOf,
              rateFetchedAt: choice.rateFetchedAt,
            }
          : {}),
      };
    }
    const row = { amount, currency, ...fields };
    createSettlementSchema.parse({ paidTo: 'recipient', ...row });
    return row;
  });
  return {
    paidCurrency: input.paidCurrency,
    settlements,
    totalPaidMinor: sumMinorAmounts(
      settlements.map((row) => row.amountPaidMinor ?? parseAmountMinor(row.amount, row.currency)),
    ),
  };
}
