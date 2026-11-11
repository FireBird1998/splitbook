import { readExpenseDraft, type ExpenseDraft } from './expense-draft';

export { roundingNote } from '@splitbook/shared/expense-entry';
export type SplitPreview = ReturnType<typeof readExpenseDraft>['split'];
export type SplitStatus = SplitPreview['status'];

/** Compatibility for the existing preview seam; the form and sheets use the whole reading. */
export function previewSplit(draft: ExpenseDraft): SplitPreview {
  return readExpenseDraft(draft).split;
}
