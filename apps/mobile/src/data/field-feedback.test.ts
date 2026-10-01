import { describe, expect, it } from 'vitest';
import { numericText } from './field-feedback';

describe('numericText', () => {
  it('keeps digits and one decimal point', () => {
    expect(numericText('1249.50')).toBe('1249.50');
    expect(numericText('.5')).toBe('.5');
    expect(numericText('12.')).toBe('12.');
  });

  it('drops letters, symbols, signs, spaces and grouping commas from typed or pasted text', () => {
    expect(numericText('abc')).toBe('');
    expect(numericText('12a')).toBe('12');
    expect(numericText('₹ 1,249.50')).toBe('1249.50');
    expect(numericText('-5')).toBe('5');
    expect(numericText('1e3')).toBe('13');
  });

  it('ignores any decimal point after the first', () => {
    expect(numericText('12.5.')).toBe('12.5');
    expect(numericText('1.2.3')).toBe('1.23');
  });

  it('keeps digits only for whole numbers, such as shares', () => {
    expect(numericText('3', true)).toBe('3');
    expect(numericText('3.', true)).toBe('3');
    expect(numericText('x2', true)).toBe('2');
  });

  it('leaves precision to validation instead of cutting digits off', () => {
    expect(numericText('10.005')).toBe('10.005');
  });
});
