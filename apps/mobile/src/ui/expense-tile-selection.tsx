import { memo } from 'react';
import type { MobileController } from '../data/mobile-controller';
import { ExpenseTiles, expenseDateLabel, splitSummary } from './expense-form';
import { paidBySummary } from './payer-sheet';
import { inactiveTagReport } from './tag-sheet';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

export const SelectedExpenseTiles = memo(function SelectedExpenseTiles({
  controller,
  currentUserId,
  ...props
}: Omit<Parameters<typeof ExpenseTiles>[0], 'values' | 'errors'> & {
  controller: MobileController;
  currentUserId?: string;
}) {
  const value = useMobileSnapshot(
    controller,
    ({ expense }) => {
      const draft = expense.draft!;
      const date = expenseDateLabel(draft.date);
      const name = (id: string) =>
        id === currentUserId
          ? 'You'
          : (expense.context?.group.members.find(({ user }) => user.id === id)?.user.name ??
            [draft.original, expense.latest]
              .flatMap((saved) => [...(saved?.paidBy ?? []), ...(saved?.splitBetween ?? [])])
              .find((row) => row.user === id)?.name ??
            'Unavailable member');
      const errors = expense.validation.errors;
      return {
        shown: date.shown,
        spoken: date.spoken,
        payers: paidBySummary(draft, name),
        split: splitSummary(draft),
        tag:
          expense.context?.tags.find((tag) => tag.id === draft.tagId)?.name ??
          (draft.tagId ? (draft.original?.tag ?? 'Unavailable Tag') : 'Choose a Tag'),
        dateError: errors.date,
        payersError: errors.payers,
        splitError: errors.split,
        tagError: errors.tag ?? inactiveTagReport(expense).error,
      };
    },
    sameSelection,
  );
  return (
    <ExpenseTiles
      {...props}
      values={{
        date: { shown: value.shown, spoken: value.spoken },
        payers: value.payers,
        split: value.split,
        tag: value.tag,
      }}
      errors={{
        date: value.dateError,
        payers: value.payersError,
        split: value.splitError,
        tag: value.tagError,
      }}
    />
  );
});
