import { describe, expect, it } from 'vitest';
import { expenseDate, expenseDay, expenseLocalDate, onExpenseDay } from './expense-day';
import { createExpenseSchema, updateExpenseSchema } from './validators/expense';

describe('an Expense is dated by calendar day (#437)', () => {
  it('reads the day it is stored on, whatever the viewer’s zone', () => {
    expect(expenseDay('2026-10-16T00:00:00.000Z')).toBe('2026-10-16');
    // Stored before #437 by Android at local noon in India.
    expect(expenseDay(new Date('2026-10-16T06:30:00.000Z'))).toBe('2026-10-16');
  });

  it('stores a day at midnight UTC', () => {
    expect(expenseDate('2026-10-16').toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(onExpenseDay(new Date('2026-10-16T06:30:00.000Z')).toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
    expect(onExpenseDay(new Date('2026-10-16T23:59:59.999Z')).toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
  });

  it('gives local formatters the same calendar day', () => {
    const local = expenseLocalDate('2026-10-16T00:00:00.000Z');
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()]).toEqual([
      2026, 9, 16, 0,
    ]);
  });
});

describe('the server stores every Expense date at midnight UTC (#437)', () => {
  const expense = {
    description: 'Ferry tickets',
    amount: 40,
    currency: 'INR',
    category: 'transport',
    tag: 'Travel',
    paidBy: [{ user: 'a00000000000000000000001', amount: 40 }],
    splitMethod: 'equal' as const,
    splitBetween: [{ user: 'a00000000000000000000001' }],
  };

  it.each([
    ['a day', '2026-10-16'],
    ['local noon from an earlier Android build', '2026-10-16T06:30:00.000Z'],
    ['midnight UTC', '2026-10-16T00:00:00.000Z'],
  ])('keeps %s as that day', (_, date) => {
    expect(createExpenseSchema.parse({ ...expense, date }).date.toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
    expect(updateExpenseSchema.parse({ date }).date?.toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
  });
});
