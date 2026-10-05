import 'server-only';

/**
 * The product switch for recurring Expenses (#289), and the one place the server reads it.
 *
 * Off by default. `RECURRING_EXPENSES_ENABLED=true` turns it on; any other value, or none,
 * leaves it off. While it is off the Group settings page shows no recurring section, the
 * recurring API refuses every change with `RECURRING_EXPENSES_OFF` and lists no templates,
 * and no read or leave generates an Expense. Nothing stored is deleted or rewritten, so
 * turning it back on brings the feature back, from the month it was turned on.
 *
 * The Household theme's `recurringExpenses` flag is separate: it says which Group type
 * supports recurring Expenses, and this switch says whether the product offers them at all.
 */

export const RECURRING_EXPENSES_OFF = 'RECURRING_EXPENSES_OFF';

/** The environment the switch is read from: `process.env`, or a stand-in in tests. */
export type RecurringExpensesSwitchEnv = Readonly<Record<string, string | undefined>>;

/** Whether recurring Expenses are on. Only `true` turns them on (surrounding spaces ignored). */
export function recurringExpensesEnabled(env: RecurringExpensesSwitchEnv = process.env): boolean {
  return env.RECURRING_EXPENSES_ENABLED?.trim() === 'true';
}

/** Throws `RECURRING_EXPENSES_OFF`, which API routes answer as 409, unless the switch is on. */
export function assertRecurringExpensesOn(env: RecurringExpensesSwitchEnv = process.env): void {
  if (!recurringExpensesEnabled(env)) throw new Error(RECURRING_EXPENSES_OFF);
}
