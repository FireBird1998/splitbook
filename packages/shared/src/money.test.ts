import { describe, expect, it } from 'vitest';
import { formatSignedCurrency, getMoneyTone, withSign } from './money';

describe('getMoneyTone', () => {
  it('classifies positive, negative, and near-zero amounts', () => {
    expect(getMoneyTone(2450)).toBe('positive');
    expect(getMoneyTone(0.01)).toBe('positive');
    expect(getMoneyTone(-18)).toBe('negative');
    expect(getMoneyTone(-0.01)).toBe('negative');
    expect(getMoneyTone(0)).toBe('neutral');
    expect(getMoneyTone(0.004)).toBe('neutral');
    expect(getMoneyTone(-0.004)).toBe('neutral');
  });
});

describe('formatSignedCurrency', () => {
  it('prefixes positive amounts with +', () => {
    expect(formatSignedCurrency(2450, 'INR')).toBe('+\u2060₹2,450.00');
  });

  it('prefixes negative amounts with a minus sign and absolute value', () => {
    expect(formatSignedCurrency(-18, 'USD')).toBe('−\u2060$18.00');
  });

  it('renders zero without a sign', () => {
    expect(formatSignedCurrency(0, 'USD')).toBe('$0.00');
  });

  it('falls back gracefully for unknown currency codes', () => {
    expect(formatSignedCurrency(5, 'NOPE')).toBe('+\u2060NOPE 5.00');
  });
});

// #899: at 200% a payment's record read "EUR: − / €20.00". A line may break between a sign and
// a currency's symbol, so a word joiner (U+2060), which has no width, keeps them together.
describe('withSign', () => {
  it('joins a sign to its figure with a word joiner, and leaves an unsigned figure alone', () => {
    expect(withSign('−', '€20.00')).toBe('−\u2060€20.00');
    expect(withSign('+', '₹620.00')).toBe('+\u2060₹620.00');
    expect(withSign('', '€0.00')).toBe('€0.00');
  });

  it('is how every signed amount is written', () => {
    expect(formatSignedCurrency(-20, 'EUR')).toBe(withSign('−', '€20.00'));
    expect(formatSignedCurrency(620, 'INR')).toBe(withSign('+', '₹620.00'));
  });
});
