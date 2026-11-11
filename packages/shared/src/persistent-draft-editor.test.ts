import { expect, it } from 'vitest';
import { entryForExpenseDraft, draftForExpenseEntry } from './expense-entry-draft';
import { expenseEntryPolicy, type IncompleteExpenseEntry } from './expense-entry';
import type { ExpenseDraftValues } from './validators/expense-draft';
const foodId = 'a00000000000000000000001';
const read = (from: ExpenseDraftValues, change: Partial<IncompleteExpenseEntry> = {}) =>
  draftForExpenseEntry({ ...entryForExpenseDraft(from), ...change }, expenseEntryPolicy, {
    from,
    changed: Object.fromEntries(Object.keys(change).map((key) => [key, true])),
  });
it('clears a named Tag when the member selects Not specified', () => {
  expect(read({ description: 'Dinner', tag: 'Food' }, { tagId: '' })).toEqual({
    description: 'Dinner',
  });
});
it('keeps an assistant-provided Tag name until it is replaced', () => {
  expect(read({ tag: 'Food' })).toEqual({ tag: 'Food' });
});
it('replaces a named Tag with the selected stable identity', () => {
  expect(read({ tag: 'Food' }, { tagId: foodId })).toEqual({ tagId: foodId });
});
it('preserves an unavailable Tag name until it is deliberately cleared', () => {
  expect(read({ tag: 'Old Label' })).toEqual({ tag: 'Old Label' });
  expect(read({ tag: 'Old Label' }, { tagId: '' })).toEqual({});
});
it('keeps a Tag identity over its older name', () => {
  expect(read({ tagId: foodId, tag: 'Old name' })).toEqual({ tagId: foodId });
});
it('does not reinterpret a hexadecimal Tag name as another Tag identity', () => {
  expect(read({ tag: foodId })).toEqual({ tag: foodId });
});
