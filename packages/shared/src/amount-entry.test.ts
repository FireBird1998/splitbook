import { describe, expect, it } from 'vitest';
import {
  type AmountEdit,
  formatAmountEntry,
  regroupAmountEntry,
  ungroupAmountEntry,
  readAmountEntry,
} from './amount-entry';

// One source for every amount field's rules and words: Record payment (#312, #514) and an
// Expense's amount (#528).
describe('readAmountEntry: what an amount field reads, in its words', () => {
  it('reads plain and grouped amounts exactly', () => {
    expect(readAmountEntry('1060', 'INR')).toEqual({ status: 'valid', amountMinor: 106000 });
    expect(readAmountEntry(' 1,060.50 ', 'INR')).toEqual({
      status: 'valid',
      amountMinor: 106050,
    });
    expect(readAmountEntry('1,234,567.8', 'USD')).toEqual({
      status: 'valid',
      amountMinor: 123456780,
    });
    expect(readAmountEntry('.5', 'EUR')).toEqual({ status: 'valid', amountMinor: 50 });
    expect(readAmountEntry('0.01', 'INR')).toEqual({ status: 'valid', amountMinor: 1 });
    expect(readAmountEntry('1060', 'JPY')).toEqual({ status: 'valid', amountMinor: 1060 });
  });

  it('is empty until something is typed', () => {
    expect(readAmountEntry('', 'INR')).toEqual({ status: 'empty' });
    expect(readAmountEntry('   ', 'INR')).toEqual({ status: 'empty' });
  });

  it('never reads a comma as a decimal point', () => {
    for (const typed of ['10,50', '1,06', '1,0600.00', ',5', '1,,000']) {
      expect(readAmountEntry(typed, 'INR')).toEqual({
        status: 'invalid',
        message: 'Enter an amount like 1,060.00.',
      });
    }
  });

  it('refuses signs, exponents, words and currency symbols', () => {
    for (const typed of ['-5', '+5', '1e3', 'ten', '₹100', '1 000', '1.2.3']) {
      expect(readAmountEntry(typed, 'INR').status).toBe('invalid');
    }
  });

  it('says a negative amount must be above zero, as zero itself does (#514)', () => {
    for (const typed of ['-5', '−5', '-0.50', '- 1,060.00'])
      expect(readAmountEntry(typed, 'INR')).toEqual({
        status: 'invalid',
        message: 'Enter an amount above ₹0.00.',
      });
    expect(readAmountEntry('-5', 'USD')).toEqual({
      status: 'invalid',
      message: 'Enter an amount above $0.00.',
    });
    expect(readAmountEntry('-ten', 'INR')).toEqual({
      status: 'invalid',
      message: 'Enter an amount like 1,060.00.',
    });
  });

  it('refuses more decimal places than the currency has', () => {
    expect(readAmountEntry('10.005', 'INR')).toEqual({
      status: 'invalid',
      message: 'Use at most 2 decimal places.',
    });
    // As the "Yen takes whole amounts" board words it (#719).
    expect(readAmountEntry('2,500.50', 'JPY')).toEqual({
      status: 'invalid',
      message: 'Yen has no smaller unit. Enter a whole amount, like ¥2,500.',
    });
    expect(readAmountEntry('1,060.5', 'KRW')).toEqual({
      status: 'invalid',
      message: 'Won has no smaller unit. Enter a whole amount, like ₩2,500.',
    });
  });

  it('refuses zero and anything above the largest amount', () => {
    expect(readAmountEntry('0', 'INR')).toEqual({
      status: 'invalid',
      message: 'Enter an amount above ₹0.00.',
    });
    expect(readAmountEntry('0.00', 'USD')).toEqual({
      status: 'invalid',
      message: 'Enter an amount above $0.00.',
    });
    expect(readAmountEntry('10000000', 'INR')).toEqual({
      status: 'valid',
      amountMinor: 1_000_000_000,
    });
    expect(readAmountEntry('10000000.01', 'INR')).toEqual({
      status: 'invalid',
      message: 'Enter at most ₹10,000,000.00.',
    });
  });
});

describe('grouped amount display (#773)', () => {
  it.each([
    ['INR', '1842.5', '1,842.50', 184250],
    ['EUR', '1842.5', '1,842.50', 184250],
    ['JPY', '1842', '1,842', 1842],
    ['KRW', '1842', '1,842', 1842],
  ])('formats %s on blur and reads the same exact minor units', (currency, typed, shown, minor) => {
    expect(formatAmountEntry(typed, currency)).toBe(shown);
    expect(readAmountEntry(shown, currency)).toEqual({ status: 'valid', amountMinor: minor });
    expect(ungroupAmountEntry(shown)).toBe(
      currency === 'JPY' || currency === 'KRW' ? '1842' : '1842.50',
    );
  });

  it('preserves empty, malformed and too-precise entries rather than repairing or rounding them', () => {
    for (const typed of ['', '1,84,2', '1e3', '-5', '1.234']) {
      expect(formatAmountEntry(typed, 'EUR')).toBe(typed);
    }
    expect(ungroupAmountEntry('1,84,2')).toBe('1,84,2');
    expect(readAmountEntry('1,84,2', 'EUR').status).toBe('invalid');
    expect(formatAmountEntry('1842.5', 'JPY')).toBe('1842.5');
  });

  /** A Backspace, Delete or Cut, or a point, from `from`: no digit and no comma typed. */
  const noDigit = (from: string): AmountEdit => ({ from, typedDigits: false });
  /** Digits typed into `from`, as over a selection, and no comma. */
  const digits = (from: string): AmountEdit => ({ from, typedDigits: true });

  it.each<[string, string, AmountEdit | undefined, string]>([
    ['1,42.50', 'EUR', noDigit('1,842.50'), '142.50'],
    ['1,5842.50', 'EUR', undefined, '15,842.50'],
    ['1,8425', 'INR', undefined, '18,425'],
    ['18,4250', 'INR', undefined, '184,250'],
    ['1842.5', 'EUR', undefined, '1,842.5'],
    ['1,842.', 'EUR', undefined, '1,842.'],
    ['.5', 'EUR', undefined, '.5'],
    ['1,42', 'JPY', noDigit('1,842'), '142'],
    ['1,000,00', 'EUR', noDigit('1,000,000'), '100,000'],
    ['1,2.50', 'EUR', noDigit('1,250'), '12.50'],
    ['184,2.50', 'EUR', noDigit('184,250'), '1,842.50'],
    ['1,9.50', 'EUR', digits('1,842.50'), '19.50'],
    ['1,9,000', 'EUR', digits('1,842,000'), '19,000'],
  ])('regroups %s in %s after %j: %s', (typed, currency, edit, regrouped) => {
    expect(regroupAmountEntry(typed, currency, edit)).toBe(regrouped);
  });

  it.each<[string, string, AmountEdit | undefined]>([
    ['10,', 'EUR', undefined],
    ['10,5', 'EUR', undefined],
    ['10,50', 'EUR', undefined],
    ['1,234,', 'EUR', undefined],
    ['1,84,2', 'EUR', undefined],
    // A comma with fewer than three digits after it stays a possible decimal comma when a point
    // or another group follows, and so does one among the decimals.
    ['10,50.', 'EUR', undefined],
    ['10,5.', 'EUR', undefined],
    ['10,5,000', 'EUR', undefined],
    ['10.5,0', 'EUR', undefined],
    ['10.5,055', 'EUR', undefined],
    ['1.5,000', 'EUR', undefined],
    ['1,842.50,000', 'EUR', undefined],
    // A comma typed first groups nothing, so it may be a decimal comma too.
    [',842', 'EUR', undefined],
    [',842.50', 'EUR', undefined],
    // Digits typed after one of the field's commas, ending the text, may mean a decimal comma;
    // and an edit of refused text keeps no commas of the field's.
    ['10,5', 'EUR', digits('10,500.00')],
    ['1,9', 'JPY', digits('1,842')],
    ['10,5', 'EUR', noDigit('10,55')],
    ['1,5', 'EUR', undefined],
    ['1,5.50', 'EUR', undefined],
    // What the currency refuses, blur leaves as typed too.
    ['1200.001', 'EUR', undefined],
    ['1842.5', 'JPY', undefined],
    ['', 'EUR', undefined],
    ['1e3', 'EUR', undefined],
    ['-5', 'EUR', undefined],
  ])('leaves %s in %s after %j as typed', (typed, currency, edit) => {
    expect(regroupAmountEntry(typed, currency, edit)).toBeNull();
  });

  it('shows zero shares and large exact values without float rounding', () => {
    expect(formatAmountEntry('0', 'EUR')).toBe('0.00');
    expect(formatAmountEntry('0001842.50', 'EUR')).toBe('1,842.50');
    expect(formatAmountEntry('9999999.99', 'EUR')).toBe('9,999,999.99');
  });
});
