import { z } from 'zod';
import { getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  MAX_EXPENSE_AMOUNT,
  MoneyValidationError,
  parseAmountMinor,
  parseExpenseAmountMinor,
} from '@splitbook/shared/exact-money';
import { calendarDate } from '@splitbook/shared/validators/calendar-date';

/**
 * Field feedback shared by the native forms (#100, #105) and the compact forms that
 * follow. Pure: no React, storage or requests.
 *
 * Errors become visible once a field is left or a save is attempted, so partial typing is
 * not treated as a mistake. `focus.request` changes once per rejected save.
 */
export interface FormValidation<F extends string> {
  submitted: boolean;
  touched: F[];
  errors: Partial<Record<F, string>>;
  focus: { field: F; request: number } | null;
}

export function emptyFormValidation<F extends string>(): FormValidation<F> {
  return { submitted: false, touched: [], errors: {}, focus: null };
}

/** Errors for fields already left, or all of them once a save was attempted. */
export function visibleFieldErrors<F extends string>(
  fields: readonly F[],
  validation: FormValidation<F>,
): Partial<Record<F, string>> {
  return Object.fromEntries(
    fields
      .filter(
        (field) =>
          validation.errors[field] && (validation.submitted || validation.touched.includes(field)),
      )
      .map((field) => [field, validation.errors[field]]),
  ) as Partial<Record<F, string>>;
}

/** A field was left: its error, if any, becomes visible. */
export function touchField<F extends string>(
  validation: FormValidation<F>,
  field: F,
  errors: Partial<Record<F, string>>,
): FormValidation<F> {
  return {
    ...validation,
    errors,
    touched: validation.touched.includes(field)
      ? validation.touched
      : [...validation.touched, field],
  };
}

/**
 * A save with invalid fields sends nothing: every error becomes visible and focus is
 * requested once on the first invalid field. Null when there is nothing to correct.
 */
export function rejectFields<F extends string>(
  fields: readonly F[],
  validation: FormValidation<F>,
  errors: Partial<Record<F, string>>,
): FormValidation<F> | null {
  const field = fields.find((name) => errors[name]);
  if (!field) return null;
  return {
    ...validation,
    submitted: true,
    errors,
    focus: { field, request: (validation.focus?.request ?? 0) + 1 },
  };
}

/** One concise announcement for a rejected save; details stay beside each field. */
export function correctionSummary<F extends string>(
  fields: readonly F[],
  labels: Record<F, string>,
  errors: Partial<Record<F, string>>,
  action: string,
): string | null {
  const invalid = fields.filter((field) => errors[field]);
  if (invalid.length <= 1) return invalid.length ? errors[invalid[0]]! : null;
  const names = invalid.map((field) => labels[field]);
  return `Correct ${invalid.length} fields before ${action}: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
}

/**
 * Keeps only what a number field can hold: digits and, unless `whole`, one decimal point.
 * The numeric keypad alone isn't enough: a hardware keyboard or a paste bypasses it.
 * Precision is left to `amountError`, so nothing typed is cut short silently.
 */
export function numericText(text: string, whole = false): string {
  const kept = text.replace(whole ? /\D/g : /[^\d.]/g, '');
  const point = kept.indexOf('.');
  return point < 0 ? kept : kept.slice(0, point + 1) + kept.slice(point + 1).replaceAll('.', '');
}

export function amountExample(currency: string) {
  const digits = getCurrencyPrecision(currency);
  return digits ? `250.${'50'.padEnd(digits, '0').slice(0, digits)}` : '250';
}

/**
 * The shared money rules for an entered Expense or Settlement amount: positive, at most
 * 10,000,000 and within the currency's precision. Nothing is ever rounded silently.
 */
export function amountError(amount: string, currency: string): string | undefined {
  const example = amountExample(currency);
  if (!amount.trim()) return `Enter the amount, such as ${example}.`;
  try {
    parseExpenseAmountMinor(amount, currency);
    return undefined;
  } catch (error) {
    const code = error instanceof MoneyValidationError ? error.code : '';
    const digits = getCurrencyPrecision(currency);
    if (code === 'INVALID_MONEY_PRECISION')
      return `${currency} amounts ${
        digits
          ? `can have at most ${digits} decimal ${digits === 1 ? 'place' : 'places'}`
          : 'can’t include decimal places'
      }. Nothing is rounded for you.`;
    if (code === 'INVALID_MONEY_RANGE' || code === 'UNSAFE_MONEY') {
      let positive = !amount.trim().startsWith('-');
      try {
        positive &&= parseAmountMinor(amount, currency) > 0;
      } catch {
        // Too large to represent exactly: still above the limit.
      }
      return positive
        ? `Enter an amount of at most ${String(MAX_EXPENSE_AMOUNT).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.`
        : 'Enter an amount greater than 0.';
    }
    return digits
      ? `Use digits and one decimal point, such as ${example}.`
      : `Use digits only, such as ${example}.`;
  }
}

/** A calendar date typed as YYYY-MM-DD; `example` shows the expected form. */
export function calendarDateError(date: string, example: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return `Enter the date as YYYY-MM-DD, such as ${example}.`;
  if (!calendarDate.safeParse(date).success || !z.iso.date().safeParse(date).success)
    return `${date} isn’t a real date. Check the day and month.`;
  return undefined;
}
