'use client';

import { useState } from 'react';
import type { ExpenseRead } from '@splitbook/shared/expense-page-read';

/** The Expenses a member has ticked in one list, and how they tick and clear them (#610). */
export interface ExpenseSelection {
  /** The selected Expenses' ids: only ones the list shows. */
  selected: ReadonlySet<string>;
  /** Tick an Expense, or untick it. */
  onSelect: (expenseId: string) => void;
  /** Tick every Expense the list shows, or untick them all once every one is ticked. */
  onSelectAll: () => void;
  /** Keep just these selected, as after a change some of them couldn't take. */
  set: (expenseIds: readonly string[]) => void;
  clear: () => void;
}

/**
 * A selection belongs to the list it was made in, known by `listKey` (its Month, filters, sort
 * and page): another key starts it empty, so nothing the member can no longer see is acted on.
 * An Expense the list stops showing, as after it was deleted, drops out of it.
 */
export function useExpenseSelection(
  listKey: string,
  expenses: readonly ExpenseRead[],
): ExpenseSelection {
  const [state, setState] = useState<{ listKey: string; ids: readonly string[] }>({
    listKey,
    ids: [],
  });
  const listed = expenses.map(({ _id }) => _id);
  const ids = state.listKey === listKey ? state.ids.filter((id) => listed.includes(id)) : [];
  const selected = new Set(ids);
  const set = (next: readonly string[]) => setState({ listKey, ids: next });
  return {
    selected,
    onSelect: (expenseId) =>
      set(selected.has(expenseId) ? ids.filter((id) => id !== expenseId) : [...ids, expenseId]),
    onSelectAll: () => set(listed.every((id) => selected.has(id)) ? [] : listed),
    set,
    clear: () => set([]),
  };
}
