/** The code the recurring API answers with while recurring Expenses are switched off (#289). */
const RECURRING_EXPENSES_OFF = 'RECURRING_EXPENSES_OFF';

export interface RecurringRefusal {
  message: string;
  /** A stale or missing revision: the section offers Reload latest. */
  conflict: boolean;
}

/**
 * What the Recurring section shows when the API refuses a save, pause, resume or delete. A
 * page left open after recurring Expenses were switched off gets 409 `RECURRING_EXPENSES_OFF`:
 * that is not an edit conflict, and reloading the template would not help.
 */
export function recurringRefusal(
  status: number,
  body: unknown,
  fallback: string,
): RecurringRefusal {
  const { error, code } = (body ?? {}) as { error?: unknown; code?: unknown };
  if (code === RECURRING_EXPENSES_OFF) {
    return { message: 'Recurring Expenses are turned off.', conflict: false };
  }
  return {
    message: typeof error === 'string' && error ? error : fallback,
    conflict: status === 409 || status === 428,
  };
}
