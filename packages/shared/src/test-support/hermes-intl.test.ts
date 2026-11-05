import { describe, expect, it } from 'vitest';

// The setup has already given this run Hermes's Intl (#863, #869). Each behaviour below is what
// Hermes 260318099.0.4 does on Android, probed on the device for #863's Tester verdict.
describe("Hermes's Intl in every test run", () => {
  it('Intl.NumberFormat refuses a BigInt, as Hermes does, and still takes a number', () => {
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

  it("BigInt's toLocaleString ignores the locale and the options, as Hermes does", () => {
    const amount = BigInt(1234567);
    expect(amount.toLocaleString('en-US', { style: 'currency', currency: 'INR' })).toBe('1234567');
    expect(amount.toLocaleString()).toBe('1234567');
    expect(BigInt(-42).toLocaleString('de-DE')).toBe('-42');
    expect(Object(BigInt(7)).toLocaleString('en-IN')).toBe('7');
  });

  it('Intl.NumberFormat reads a numeric string as a Number, so a long one is rounded, as Hermes does', () => {
    const plain = new Intl.NumberFormat('en-US');
    // Node formats the string's every digit; Hermes rounds it to the nearest double first.
    expect(plain.format('12345678901234567890' as unknown as number)).toBe(
      '12,345,678,901,234,567,000',
    );
    expect(
      plain
        .formatToParts('12345678901234567890' as unknown as number)
        .map((part) => part.value)
        .join(''),
    ).toBe('12,345,678,901,234,567,000');
    // A string a double holds exactly formats as it reads, on Hermes too.
    const rupees = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'INR' });
    expect(rupees.format('1234.5' as unknown as number)).toBe('₹1,234.50');
    expect(plain.format('not a number' as unknown as number)).toBe('NaN');
  });

  it('formatRange, formatRangeToParts and Intl.PluralRules are absent, as on Hermes', () => {
    const format = new Intl.NumberFormat('en-US');
    expect(typeof (format as unknown as Record<string, unknown>).formatRange).toBe('undefined');
    expect(typeof (format as unknown as Record<string, unknown>).formatRangeToParts).toBe(
      'undefined',
    );
    expect('formatRange' in Intl.NumberFormat.prototype).toBe(false);
    expect('formatRangeToParts' in Intl.NumberFormat.prototype).toBe(false);
    expect('PluralRules' in Intl).toBe(false);
    expect(typeof (Intl as unknown as Record<string, unknown>).PluralRules).toBe('undefined');
  });
});
