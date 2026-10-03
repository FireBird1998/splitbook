import { describe, expect, it } from 'vitest';
import { payerEntryError } from './payer-remainder';

// The payer arithmetic is tested with the shared rules; this is only how each problem reads.
describe('payer entry errors', () => {
  it('says why an entry cannot count, without rounding', () => {
    expect(payerEntryError('10.005', 'INR')).toBe(
      'INR amounts can have at most 2 decimal places. Nothing is rounded for you.',
    );
    expect(payerEntryError('1.5', 'JPY')).toBe(
      'JPY amounts can’t include decimal places. Nothing is rounded for you.',
    );
    expect(payerEntryError('1.2.3', 'INR')).toBe(
      'Use digits and one decimal point, such as 250.50.',
    );
    expect(payerEntryError('-5', 'INR')).toBe('Enter an amount of 0 or more.');
    expect(payerEntryError('10000001', 'INR')).toBe('Enter an amount of at most 10,000,000.');
  });

  it('accepts 0 and leaves a blank entry empty', () => {
    expect(payerEntryError('0', 'INR')).toBeUndefined();
    expect(payerEntryError('  ', 'INR')).toBeUndefined();
  });
});
