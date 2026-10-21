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

/** Commas only as thousands separators, in their usual places: "1,060.50", not "10,50". */
const thousandsGrouped = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

/** Digits, with a point and any decimals: "1060.5", ".5", "1060.". */
const plainAmount = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A comma that may be a decimal comma: first, with fewer than three digits after it, or among the
 * decimals.
 */
const decimalComma = /^,|,\d{0,2}(?!\d)|\..*,/;

/** "1842" grouped in threes: "1,842". */
const groupInThrees = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

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
  if (typed.includes(',') && !thousandsGrouped.test(typed)) {
    return { status: 'invalid', message: like };
  }
  const plain = typed.replaceAll(',', '');
  if (!plainAmount.test(plain)) return { status: 'invalid', message: like };
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

/** Remove only correctly placed thousands separators; malformed input remains a refusal. */
export function ungroupAmountEntry(text: string): string {
  return thousandsGrouped.test(text.trim()) ? text.trim().replaceAll(',', '') : text;
}

/**
 * The amount being typed, grouped as it is typed (#773): its commas dropped and its whole part
 * grouped in threes, as `formatAmountEntry` groups it on blur, its decimals as typed and not
 * padded. Backspace after the 8 in "1,842.50" leaves "1,42.50", which reads "142.50"; a 5 typed
 * after "1," gives "15,842.50".
 *
 * Null where the text stays as typed, as blur leaves it: not an amount the currency takes even
 * without its commas, or with a comma that may be a decimal comma ("10,5", "10,50.", ",842", "1.5,00"),
 * so "10,5" is refused rather than read as 105. `keptFrom` is the text an edit that typed no digit
 * and no comma kept its commas from: a Backspace, Delete or Cut, or a point typed alone. Only when
 * that text was grouped is such a comma the field's own, as in "1,842" less its 8, "1,42", which
 * reads 142, or "1,250" with a point after the 12, "1,2.50", which reads 12.50.
 */
export function regroupAmountEntry(
  text: string,
  currency: string,
  keptFrom?: string,
): string | null {
  const plain = text.replaceAll(',', '');
  if (!plainAmount.test(plain)) return null;
  if (decimalComma.test(text) && !thousandsGrouped.test(keptFrom ?? '')) return null;
  try {
    parseAmountMinor(plain, currency);
  } catch {
    return null;
  }
  const [whole = '', fraction] = plain.split('.');
  return fraction === undefined ? groupInThrees(whole) : `${groupInThrees(whole)}.${fraction}`;
}

/** Display on blur only. Invalid input stays visible, and no amount is rounded or repaired. */
export function formatAmountEntry(text: string, currency: string): string {
  const plain = ungroupAmountEntry(text).trim();
  if (!plainAmount.test(plain)) return text;
  try {
    const minor = BigInt(parseAmountMinor(plain, currency));
    const precision = getCurrencyPrecision(currency);
    const digits = minor.toString().padStart(precision + 1, '0');
    const whole = precision ? digits.slice(0, -precision) : digits;
    const grouped = groupInThrees(whole);
    return precision ? `${grouped}.${digits.slice(-precision)}` : grouped;
  } catch {
    return text;
  }
}
