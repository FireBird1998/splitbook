import { describe, expect, it } from 'vitest';
import { formatSignedCurrency, getMoneyTone } from './money';

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
    expect(formatSignedCurrency(2450, 'INR')).toBe('+₹2,450.00');
  });

  it('prefixes negative amounts with a minus sign and absolute value', () => {
    expect(formatSignedCurrency(-18, 'USD')).toBe('−$18.00');
  });

  it('renders zero without a sign', () => {
    expect(formatSignedCurrency(0, 'USD')).toBe('$0.00');
  });

  it('falls back gracefully for unknown currency codes', () => {
    expect(formatSignedCurrency(5, 'NOPE')).toBe('+NOPE 5.00');
  });
});
