import { describe, expect, it } from 'vitest';
import { recurringRefusal } from './recurring-refusal';

// What the Recurring section shows when a save, pause, resume or delete is refused.
describe('a refused recurring change', () => {
  it('says recurring Expenses are turned off, with no Reload latest, when the switch is off', () => {
    expect(
      recurringRefusal(
        409,
        {
          error: 'Recurring Expenses are turned off.',
          code: 'RECURRING_EXPENSES_OFF',
          status: 409,
        },
        'Failed to save',
      ),
    ).toEqual({ message: 'Recurring Expenses are turned off.', conflict: false });
    // The code decides, whatever text a stale server sends with it.
    expect(recurringRefusal(409, { code: 'RECURRING_EXPENSES_OFF' }, 'Failed to delete')).toEqual({
      message: 'Recurring Expenses are turned off.',
      conflict: false,
    });
  });

  it('offers Reload latest for a stale or missing revision, with the server’s message', () => {
    const stale =
      'This record changed while you were editing. Reload the latest version before saving.';
    expect(
      recurringRefusal(409, { error: stale, code: 'STALE_REVISION' }, 'Failed to save'),
    ).toEqual({ message: stale, conflict: true });
    expect(
      recurringRefusal(428, { error: 'Reload this record before changing it.' }, 'Failed to save'),
    ).toEqual({ message: 'Reload this record before changing it.', conflict: true });
  });

  it('shows any other refusal’s message, or the fallback, without Reload latest', () => {
    expect(
      recurringRefusal(422, { error: 'Tag must be an active group tag' }, 'Failed to save'),
    ).toEqual({ message: 'Tag must be an active group tag', conflict: false });
    expect(recurringRefusal(500, null, 'Failed to update')).toEqual({
      message: 'Failed to update',
      conflict: false,
    });
  });
});
