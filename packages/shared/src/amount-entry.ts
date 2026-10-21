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

/** Remove only correctly placed thousands separators; malformed input remains a refusal. */
export function ungroupAmountEntry(text: string): string {
  return thousandsGrouped.test(text.trim()) ? text.trim().replaceAll(',', '') : text;
}

/**
 * The amount being typed, grouped as it is typed (#773): its commas dropped and its whole part
 * grouped in threes, as `formatAmountEntry` groups it on blur, its decimals as typed and not
 * padded. `before` is the text the field showed before this edit. Backspace after the 8 in
 * "1,842.50" leaves "1,42.50", which reads "142.50"; a 5 typed after "1," gives "15,842.50".
 *
 * Null where the text stays as typed: not an amount even without its commas, or ending in a
 * comma and at most two digits, as a decimal comma would ("10,", "10,5"), so "10,5" is refused
 * rather than read as 105. Only deleting from grouped text may leave one of its own commas
 * there: "1,842" less its 8 is "1,42", which reads 142.
 */
export function regroupAmountEntry(text: string, before: string): string | null {
  const plain = text.replaceAll(',', '');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(plain)) return null;
  if (/,\d{0,2}$/.test(text) && !(thousandsGrouped.test(before) && onlyDeleted(before, text))) {
    return null;
  }
  const [whole = '', fraction] = plain.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Whether `after` is `before` less one run of characters, as Backspace, Delete or Cut leave it. */
function onlyDeleted(before: string, after: string): boolean {
  let kept = 0;
  while (kept < after.length && after[kept] === before[kept]) kept++;
  return after.length < before.length && before.endsWith(after.slice(kept));
}

/** Display on blur only. Invalid input stays visible, and no amount is rounded or repaired. */
export function formatAmountEntry(text: string, currency: string): string {
  const plain = ungroupAmountEntry(text).trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(plain)) return text;
  try {
    const minor = BigInt(parseAmountMinor(plain, currency));
    const precision = getCurrencyPrecision(currency);
    const digits = minor.toString().padStart(precision + 1, '0');
    const whole = precision ? digits.slice(0, -precision) : digits;
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return precision ? `${grouped}.${digits.slice(-precision)}` : grouped;
  } catch {
    return text;
  }
}
