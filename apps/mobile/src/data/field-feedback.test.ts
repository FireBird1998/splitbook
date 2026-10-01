import { describe, expect, it } from 'vitest';
import { acceptsNumericText } from './field-feedback';

describe('acceptsNumericText', () => {
  it('accepts digits and a decimal point, including while typing', () => {
    for (const text of ['', '1249.50', '.5', '12.', '0'])
      expect(acceptsNumericText(text, '')).toBe(true);
  });

  it('refuses a letter, symbol or space whole instead of stripping it', () => {
    for (const text of ['12a', '₹1249.50', '1e3', ' 5', '+5'])
      expect(acceptsNumericText(text, '12')).toBe(false);
  });

  it('keeps signs, commas and extra points for the field’s correction, never converting them', () => {
    for (const text of ['-5', '1,249.50', '12.5.', '1.5'])
      expect(acceptsNumericText(text, '')).toBe(true);
  });

  it('keeps text already outside the set, such as an older draft’s, editable', () => {
    expect(acceptsNumericText('12a', '12ab')).toBe(true);
  });
});
