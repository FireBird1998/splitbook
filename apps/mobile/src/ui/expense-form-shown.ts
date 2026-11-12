import type { ExpenseEditor } from '../data/expense-draft';

/** The form for a draft, rather than loading, a notice or a saved record. */
export const expenseFormShown = ({ draft, status }: ExpenseEditor) =>
  !!draft &&
  status !== 'loading' &&
  !(draft.original && ['detail', 'delete-review'].includes(status));
