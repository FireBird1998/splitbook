import { describe, expect, it } from 'vitest';
import { createExpenseSchema } from './expense';
import { createGroupSchema, updateGroupSchema } from './group';
import { createRecurringExpenseSchema } from './recurring-expense';

const payer = '507f1f77bcf86cd799439011';
const money = {
  description: 'Groceries',
  amount: 100,
  currency: 'INR',
  tag: 'Food',
  paidBy: [{ user: payer, amount: 100 }],
  splitMethod: 'equal',
  splitBetween: [{ user: payer }],
};
const trip = { name: 'Goa', category: 'trip', defaultCurrency: 'INR' };

const parsers: Array<[string, (value: unknown) => { success: boolean; data?: unknown }]> = [
  ['expense date', (date) => createExpenseSchema.safeParse({ ...money, date })],
  [
    'recurring start',
    (startsOn) => createRecurringExpenseSchema.safeParse({ ...money, dayOfMonth: 1, startsOn }),
  ],
  [
    'recurring end',
    (endsOn) =>
      createRecurringExpenseSchema.safeParse({
        ...money,
        dayOfMonth: 1,
        startsOn: '2026-01-01',
        endsOn,
      }),
  ],
  ['group start', (startDate) => createGroupSchema.safeParse({ ...trip, startDate })],
  ['group update end', (endDate) => updateGroupSchema.safeParse({ endDate })],
];

describe('calendar dates in request schemas', () => {
  for (const [label, parse] of parsers) {
    it(`rejects impossible calendar days for the ${label} instead of rolling them over`, () => {
      for (const value of [
        '2026-02-31',
        '2026-02-29',
        '2026-04-31',
        '2026-13-01',
        '2026-00-10',
        '2026-06-31T10:00:00.000Z',
        '2026-02-31t10:00:00.000z',
        '2026-02-31 10:00:00Z',
        ' 2026-02-31 ',
      ]) {
        expect(parse(value).success, value).toBe(false);
      }
    });

    it(`accepts real dates and timestamps for the ${label}`, () => {
      for (const value of [
        '2028-02-29',
        '2026-12-31',
        '2026-09-28T18:30:00.000Z',
        '2026-09-28t18:30:00.000z',
      ]) {
        expect(parse(value).success, value).toBe(true);
      }
      expect(parse(new Date('2026-09-28T00:00:00.000Z')).success).toBe(true);
    });
  }

  it('keeps the parsed instant unchanged for valid dates', () => {
    const parsed = createExpenseSchema.parse({ ...money, date: '2028-02-29' });
    expect(parsed.date.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('preserves valid four-digit years below 0100', () => {
    for (const date of ['0099-01-01', '0000-02-29']) {
      const parsed = createExpenseSchema.parse({ ...money, date });
      expect(parsed.date.toISOString().slice(0, 10)).toBe(date);
    }
  });

  it('still treats blank optional Group dates as absent', () => {
    const parsed = createGroupSchema.parse({ ...trip, startDate: '', endDate: null });
    expect(parsed.startDate).toBeNull();
    expect(parsed.endDate).toBeNull();
  });
});
