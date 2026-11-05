import { expect, it } from 'vitest';

// The Android run's setup gives every test Hermes's Intl; the shared stub's own test pins each
// behaviour (packages/shared/src/test-support/hermes-intl.test.ts). This checks it is installed here.
it("runs every Android test with Hermes's Intl (#863, #869)", () => {
  const format = new Intl.NumberFormat('en-US');
  // Through a name: the lint rule refuses a BigInt passed straight to Intl.
  const five = BigInt(5);
  expect(() => format.format(five)).toThrow('Cannot convert BigInt to number');
  expect(format.format('12345678901234567890' as unknown as number)).toBe(
    '12,345,678,901,234,567,000',
  );
  expect(BigInt(1234567).toLocaleString('en-US', { style: 'currency', currency: 'INR' })).toBe(
    '1234567',
  );
  expect('formatRange' in format).toBe(false);
  expect('formatRangeToParts' in format).toBe(false);
  expect('PluralRules' in Intl).toBe(false);
});
