import type { DraftReview } from '@splitbook/shared/validators/expense-draft';

/** Unsaved matches need no Expense read; every saved match must have been shown. */
export function matchingExpensesLoaded(
  matches: readonly DraftReview['duplicates'][number][],
  loadedIds: readonly string[],
): boolean {
  return matches.every((match) => match.kind !== 'expense' || loadedIds.includes(match.id));
}
