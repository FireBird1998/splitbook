import { describe, expect, it } from 'vitest';
import { lineMayWrap } from './person-name';

// #928: whether a Paid by or Share line, a name and its written amount, may wrap. An everyday
// line stays whole, as #646 sets it; a long one, by its name or by its amount, may wrap.
describe('lineMayWrap', () => {
  it('keeps an everyday name and its amount on one line', () => {
    expect(lineMayWrap('Alex Rivera', '₹54,000.00')).toBe(false);
    expect(lineMayWrap('Priyamvada Ven', '₹51,333.50')).toBe(false);
    expect(lineMayWrap('Alex Rivera')).toBe(false);
  });

  it('lets a line wrap from 25 characters, counting the amount beside the name', () => {
    // 16 + 10: past the A4 page beside three payers' amounts at 41649714.
    expect(lineMayWrap('Venkataraghavans', '₹51,333.50')).toBe(true);
    expect(lineMayWrap('Priyamvada Venk', '₹51,333.50')).toBe(true);
    expect(lineMayWrap('Alex Rivera', '₹123,456,789.00')).toBe(true);
    expect(lineMayWrap('Priyamvada Venkataraghavan-Subramaniam')).toBe(true);
  });
});
