import { recording } from './test-support/expense-entry-recording';
import { expect, it } from 'vitest';
import { normalizeExpenseMoney } from './exact-money';
import { completeExpenseDraftSchema } from './validators/expense-draft';
import { entries, numericDraft, refusal, type Reading } from './test-support/expense-entry-cases';

it('records server completion of each numeric Draft (#1111)', async () => {
  const cells: Record<string, Reading> = {};
  for (const row of entries) {
    if (row.savedZeroPayer) {
      cells[row.id] = {
        result: {
          kind: 'unsupported',
          reason: 'Completing a Draft creates an Expense; it does not edit a saved Expense.',
        },
      };
      continue;
    }
    const input = numericDraft(row);
    const unreadable = (value: unknown): boolean =>
      typeof value === 'number'
        ? !Number.isFinite(value)
        : !!value && typeof value === 'object' && Object.values(value).some(unreadable);
    if (unreadable(input)) {
      cells[row.id] = {
        result: {
          kind: 'unsupported',
          reason: 'A stored numeric Draft cannot hold unreadable typed text.',
        },
      };
      continue;
    }
    const result = completeExpenseDraftSchema.safeParse(input);
    cells[row.id] = {
      result: result.success ? { kind: 'command', value: result.data } : refusal(result.error),
      ...(result.success ? { shown: { allocation: normalizeExpenseMoney(result.data) } } : {}),
    };
  }
  await expect(await recording(cells)).toMatchFileSnapshot(
    '../../../test/expense-entry-readings/recordings/server-complete.json',
  );
});
