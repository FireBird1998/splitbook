import { describe, expect, it } from 'vitest';
import { isPossibleExpenseDuplicate } from './expense-duplicate';

const values = { description: 'Taxi', amount: 10.25, currency: 'INR', date: '2026-10-14' };
describe('possible expense duplicates', () => {
  it('compares normalized descriptions and the existing UTC date rule', () => {
    expect(
      isPossibleExpenseDuplicate(values, {
        ...values,
        description: ' TAXI ',
        date: '2026-10-14T23:59:59.000Z',
      }),
    ).toBe(true);
  });
  it.each([
    { description: 'Bus' },
    { amount: 10.26 },
    { currency: 'USD' },
    { date: '2026-10-15' },
    { description: undefined },
    { amount: undefined },
    { currency: undefined },
    { date: undefined },
  ])('rejects different or missing facts: %j', (change) => {
    expect(isPossibleExpenseDuplicate(values, { ...values, ...change })).toBe(false);
    expect(isPossibleExpenseDuplicate({ ...values, ...change }, values)).toBe(false);
  });
  it('never warns for two incomplete entries', () => {
    expect(isPossibleExpenseDuplicate({}, {})).toBe(false);
  });
});
