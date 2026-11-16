import { describe, expect, it } from 'vitest';
import { amountToFit, dayCellAmount, fullAmount, shortAmount } from './compact-amount';

// The "Number rules" table on board SpendAndSettings (#1272). Amounts are minor units:
// ₹1,421,780.00 is 142178000 paise; yen and won have no minor unit.
const NBSP = ' ';

describe('an amount in full', () => {
  it("is written as the app writes money everywhere: symbol, commas every three digits, the currency's decimals", () => {
    expect(fullAmount(142_178_000, 'INR')).toBe('₹1,421,780.00');
    expect(fullAmount(6_000, 'PLN')).toBe(`PLN${NBSP}60.00`);
    expect(fullAmount(420_000, 'JPY')).toBe('¥420,000');
    expect(fullAmount(0, 'INR')).toBe('₹0.00');
  });

  it('groups rupees in threes, not in lakhs (#1270)', () => {
    expect(fullAmount(620_000_000, 'INR')).toBe('₹6,200,000.00');
  });

  it("writes each Expense in a day's list as the member's share of its total", () => {
    expect(`${fullAmount(124_000_000, 'INR')} of ${fullAmount(620_000_000, 'INR')}`).toBe(
      '₹1,240,000.00 of ₹6,200,000.00',
    );
  });
});

describe('a shortened amount', () => {
  it('writes rupees with K, L and Cr: three figures at most, zeros at the end dropped', () => {
    expect(shortAmount(1_200_000, 'INR')).toBe('₹12K');
    expect(shortAmount(12_500_000, 'INR')).toBe('₹1.25L');
    expect(shortAmount(142_178_000, 'INR')).toBe('₹14.2L');
    expect(shortAmount(1_250_000_000, 'INR')).toBe('₹1.25Cr');
  });

  it('writes other currencies with K and M; lakh and crore are for rupees only', () => {
    expect(shortAmount(1_200_000, 'EUR')).toBe('€12K');
    expect(shortAmount(125_000_000, 'EUR')).toBe('€1.25M');
    expect(shortAmount(186_000, 'JPY')).toBe('¥186K');
    expect(shortAmount(12_500_000, 'EUR')).toBe('€125K');
    expect(shortAmount(1_250_000_000, 'USD')).toBe('$12.5M');
  });

  it('rounds a half up, and moves to the next unit when rounding reaches it', () => {
    expect(shortAmount(142_499_999, 'INR')).toBe('₹14.2L');
    expect(shortAmount(142_500_000, 'INR')).toBe('₹14.3L');
    expect(shortAmount(9_999_900, 'INR')).toBe('₹1L');
    expect(shortAmount(99_999_900, 'EUR')).toBe('€1M');
    expect(shortAmount(99_950, 'INR')).toBe('₹1K');
  });

  it('writes an amount under a thousand in three figures, without a unit', () => {
    expect(shortAmount(8_600, 'EUR')).toBe('€86');
    expect(shortAmount(42_050, 'INR')).toBe('₹421');
    expect(shortAmount(125, 'EUR')).toBe('€1.25');
    expect(shortAmount(40, 'EUR')).toBe('€0.4');
    expect(shortAmount(5, 'EUR')).toBe('€0.05');
    expect(shortAmount(0, 'INR')).toBe('₹0');
  });

  it('keeps the largest unit past it, grouped in threes', () => {
    expect(shortAmount(1_250_000_000_000, 'INR')).toBe('₹1,250Cr');
    expect(shortAmount(150_000_000_000, 'EUR')).toBe('€1,500M');
  });

  it('puts the symbol where full amounts put it', () => {
    expect(shortAmount(6_000_000, 'PLN')).toBe(`PLN${NBSP}60K`);
    expect(shortAmount(1_200_000, 'CAD')).toBe('CA$12K');
    expect(shortAmount(-1_200_000, 'INR')).toBe('-₹12K');
  });

  it('writes the code before it when the currency cannot be formatted, as full amounts do', () => {
    expect(shortAmount(1_200_000, 'EURO')).toBe('EURO 12K');
    expect(shortAmount(-1_200_000, 'EURO')).toBe('EURO -12K');
  });
});

describe('an amount fitted to its place: the Home card and totals', () => {
  it('is written in full whenever it fits on its line', () => {
    expect(amountToFit(2_350_000, 'INR', 12)).toBe('₹23,500.00');
    expect(amountToFit(8_600, 'EUR', 12)).toBe('€86.00');
    expect(amountToFit(420_000, 'JPY', 12)).toBe('¥420,000');
    expect(amountToFit(142_178_000, 'INR', 13)).toBe('₹1,421,780.00');
  });

  it('says zero in full for an empty month', () => {
    expect(amountToFit(0, 'INR', 12)).toBe('₹0.00');
  });

  it('is shortened, with its symbol, only when the full amount does not fit', () => {
    expect(amountToFit(142_178_000, 'INR', 12)).toBe('₹14.2L');
    expect(amountToFit(2_350_000, 'INR', 9)).toBe('₹23.5K');
  });

  it('drops figures when three do not fit, and gives its shortest form when nothing does', () => {
    expect(amountToFit(142_178_000, 'INR', 5)).toBe('₹14L');
    expect(amountToFit(142_178_000, 'INR', 3)).toBe('₹10L');
  });
});

describe('a day cell', () => {
  it('shows whole units without symbol or decimals, in full up to what the cell holds', () => {
    expect(dayCellAmount(42_000, 'INR', 6)).toBe('420');
    expect(dayCellAmount(1_200_000, 'INR', 6)).toBe('12,000');
    expect(dayCellAmount(4_500_000, 'INR', 6)).toBe('45,000');
    expect(dayCellAmount(420_000, 'JPY', 7)).toBe('420,000');
  });

  it('is shortened, without its symbol, when the whole units do not fit', () => {
    expect(dayCellAmount(12_500_000, 'INR', 6)).toBe('1.25L');
    expect(dayCellAmount(124_000_000, 'INR', 6)).toBe('12.4L');
    expect(dayCellAmount(420_000, 'JPY', 6)).toBe('420K');
  });

  it('shortens sooner at large text, where the cell holds fewer characters', () => {
    expect(dayCellAmount(1_200_000, 'INR', 4)).toBe('12K');
    expect(dayCellAmount(118_000, 'INR', 4)).toBe('1.2K');
  });

  it('rounds to whole units, a half up', () => {
    expect(dayCellAmount(42_049, 'INR', 6)).toBe('420');
    expect(dayCellAmount(42_050, 'INR', 6)).toBe('421');
    expect(dayCellAmount(99_950, 'INR', 6)).toBe('1,000');
  });

  it('shows "<1" for a share under one unit, so a day with spending never looks empty', () => {
    expect(dayCellAmount(99, 'INR', 6)).toBe('<1');
    expect(dayCellAmount(1, 'EUR', 6)).toBe('<1');
    expect(dayCellAmount(100, 'INR', 6)).toBe('1');
    expect(dayCellAmount(1, 'JPY', 6)).toBe('1');
  });

  it('is empty for a day with nothing', () => {
    expect(dayCellAmount(0, 'INR', 6)).toBe('');
  });

  it('refuses a negative share, which no day has', () => {
    expect(() => dayCellAmount(-100, 'INR', 6)).toThrow(RangeError);
  });
});
