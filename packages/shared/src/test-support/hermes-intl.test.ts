import { expect, it } from 'vitest';

// The setup has already made Intl refuse a BigInt, as Hermes does (#863).
it('Intl.NumberFormat refuses a BigInt in every test run, as Hermes does, and still takes a number', () => {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'INR' });
  // Through a name, which the lint rule against a BigInt passed straight to Intl doesn't see.
  const five = BigInt(5);
  expect(() => format.format(five)).toThrow(new TypeError('Cannot convert BigInt to number'));
  expect(() => format.formatToParts(five)).toThrow('Cannot convert BigInt to number');
  expect(format.format(5)).toBe('₹5.00');
  expect(
    format
      .formatToParts(5)
      .map((part) => part.value)
      .join(''),
  ).toBe('₹5.00');
});
