import { describe, expect, it } from 'vitest';
import { matchingExpensesLoaded } from './review-matches';

describe('matching Expense gate', () => {
  it('requires each matching saved Expense to have loaded', () => {
    const matches = [
      { kind: 'expense' as const, id: 'a', description: 'Meal' },
      { kind: 'expense' as const, id: 'b', description: 'Taxi' },
    ];
    expect(matchingExpensesLoaded(matches, [])).toBe(false);
    expect(matchingExpensesLoaded(matches, ['a'])).toBe(false);
    expect(matchingExpensesLoaded(matches, ['unrelated'])).toBe(false);
    expect(matchingExpensesLoaded(matches, ['a', 'b'])).toBe(true);
  });
  it('does not require an Expense read for another unsaved item or no matches', () => {
    expect(matchingExpensesLoaded([], [])).toBe(true);
    expect(matchingExpensesLoaded([{ kind: 'draft', id: 'draft', description: 'Meal' }], [])).toBe(
      true,
    );
    expect(
      matchingExpensesLoaded(
        [
          { kind: 'draft', id: 'draft', description: 'Meal' },
          { kind: 'expense', id: 'saved', description: 'Meal' },
        ],
        ['saved'],
      ),
    ).toBe(true);
  });
});
