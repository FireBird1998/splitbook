import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRecurringExpensesOn,
  RECURRING_EXPENSES_OFF,
  recurringExpensesEnabled,
} from './recurring-expenses-switch';

afterEach(() => vi.unstubAllEnvs());

describe('the recurring Expenses switch', () => {
  it('is off when RECURRING_EXPENSES_ENABLED is not set', () => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', undefined);
    expect(recurringExpensesEnabled()).toBe(false);
    expect(() => assertRecurringExpensesOn()).toThrow(RECURRING_EXPENSES_OFF);
  });

  it('is on only for an explicit true', () => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    expect(recurringExpensesEnabled()).toBe(true);
    expect(() => assertRecurringExpensesOn()).not.toThrow();
    // A value pasted with a trailing newline still counts.
    expect(recurringExpensesEnabled({ RECURRING_EXPENSES_ENABLED: ' true\n' })).toBe(true);
  });

  it.each(['', 'false', 'TRUE', 'True', '1', 'yes', 'on', 'enabled'])(
    'stays off for %j',
    (value) => {
      expect(recurringExpensesEnabled({ RECURRING_EXPENSES_ENABLED: value })).toBe(false);
      expect(() => assertRecurringExpensesOn({ RECURRING_EXPENSES_ENABLED: value })).toThrow(
        RECURRING_EXPENSES_OFF,
      );
    },
  );
});
