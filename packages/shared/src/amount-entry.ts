/**
 * What an amount field reads, and why it won't take an amount, in the words every amount field
 * shows: Record payment's (#312, #514) and an Expense's (#528). Framework-free, so any form can
 * use it.
 */
import { formatCurrency, getCurrencyPrecision, wholeUnit } from './currency';
import { MAX_EXPENSE_AMOUNT, MoneyValidationError, parseAmountMinor } from './exact-money';

export type AmountReading =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; amountMinor: number };

/** "1,060.00", or "1,060" for a currency without decimal places. */
const example = (currency: string) => (getCurrencyPrecision(currency) === 0 ? '1,060' : '1,060.00');

/**
 * "Yen has no smaller unit. Enter a whole amount, like ¥2,500.": part of a whole-unit currency's
 * unit, in the words every amount says it (#719), a payer's and a share's too (#755). Undefined
 * for a currency with decimal places.
 */
export function wholeAmountWords(currency: string): string | undefined {
  const unit = wholeUnit(currency);
  return unit
    ? `${unit.charAt(0).toUpperCase()}${unit.slice(1)} has no smaller unit. Enter a whole amount, like ${formatCurrency(2500, currency)}.`
    : undefined;
}

/**
 * A money rule's refusal of part of a whole-unit currency's unit, such as a payer's ¥1,250.5, in
 * those words (#755) rather than "Amount supports at most 0 decimal places"; any other error as
 * it is. Its code and field stay.
 */
export function inAmountWords(error: unknown, currency: string): unknown {
  if (!(error instanceof MoneyValidationError) || error.code !== 'INVALID_MONEY_PRECISION')
    return error;
  const words = wholeAmountWords(currency);
  return words ? new MoneyValidationError(error.code, words, error.field) : error;
}

/** "Enter an amount above ₹0.00.": zero's words, for zero and anything below it. */
const aboveZero = (currency: string) => `Enter an amount above ${formatCurrency(0, currency)}.`;

/**
 * The amount typed, in exact minor units. Commas are read only as thousands separators in
 * their usual places ("1,060.50"), so "10,50" is refused rather than read as 1,050.
 */
export function readAmountEntry(text: string, currency: string): AmountReading {
  const typed = text.trim();
  if (typed === '') return { status: 'empty' };
  const like = `Enter an amount like ${example(currency)}.`;
  // A negative amount gets zero's words: what's wanted, not a format (#514).
  if (/^[-−]\s*(?:\d[\d,]*(?:\.\d*)?|\.\d+)$/.test(typed)) {
    return { status: 'invalid', message: aboveZero(currency) };
  }
  if (typed.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(typed)) {
    return { status: 'invalid', message: like };
  }
  const plain = typed.replaceAll(',', '');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(plain)) return { status: 'invalid', message: like };
  let amountMinor: number;
  try {
    amountMinor = parseAmountMinor(plain, currency);
  } catch (error) {
    if (error instanceof MoneyValidationError && error.code === 'INVALID_MONEY_PRECISION') {
      return {
        status: 'invalid',
        message:
          wholeAmountWords(currency) ??
          `Use at most ${getCurrencyPrecision(currency)} decimal places.`,
      };
    }
    return { status: 'invalid', message: like };
  }
  if (amountMinor <= 0) return { status: 'invalid', message: aboveZero(currency) };
  if (amountMinor > MAX_EXPENSE_AMOUNT * 10 ** getCurrencyPrecision(currency)) {
    return {
      status: 'invalid',
      message: `Enter at most ${formatCurrency(MAX_EXPENSE_AMOUNT, currency)}.`,
    };
  }
  return { status: 'valid', amountMinor };
}
