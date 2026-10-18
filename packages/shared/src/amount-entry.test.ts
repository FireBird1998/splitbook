import { describe, expect, it } from 'vitest';
import { readAmountEntry } from './amount-entry';

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
    expect(readAmountEntry('10.5', 'JPY')).toEqual({
      status: 'invalid',
      message: 'JPY amounts have no decimal places.',
    });
    expect(readAmountEntry('1,060.5', 'KRW')).toMatchObject({ status: 'invalid' });
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
