import { memo } from 'react';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { expenseContextPending, expenseMoney } from '../data/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import { SaveBar } from './expense-form';
import { useMobileSnapshot } from './use-mobile-snapshot';
import { amountError } from '../data/field-feedback';

/** The Save amount follows current entries, independently of the task frame. */
export const SelectedSaveBar = memo(function SelectedSaveBar({
  controller,
  ...props
}: Parameters<typeof SaveBar>[0] & { controller: MobileController }) {
  const amount = useMobileSnapshot(controller, ({ expense, offline }) => {
    if (
      !expense.draft ||
      expense.status === 'saving' ||
      expenseContextPending(expense, offline.active)
    )
      return undefined;
    try {
      const money = expenseMoney(expense.draft);
      return formatCurrency(
        toMajorAmount(money.amountMinor, expense.draft.currency),
        expense.draft.currency,
      );
    } catch {
      return undefined;
    }
  });
  // The amount typed can't be saved: the footer gives back the line Save's amount took (#925).
  const amountWrong = useMobileSnapshot(
    controller,
    ({ expense }) => !!expense.draft && !!amountError(expense.draft.amount, expense.draft.currency),
  );
  return <SaveBar {...props} amount={amount} amountWrong={amountWrong} />;
});
