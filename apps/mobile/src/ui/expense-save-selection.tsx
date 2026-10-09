import { memo } from 'react';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { expenseMoney } from '../data/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import { SaveBar } from './expense-form';
import { useMobileSnapshot } from './use-mobile-snapshot';

/** The Save amount follows current entries, independently of the task frame. */
export const SelectedSaveBar = memo(function SelectedSaveBar({
  controller,
  ...props
}: Parameters<typeof SaveBar>[0] & { controller: MobileController }) {
  const amount = useMobileSnapshot(controller, ({ expense }) => {
    if (!expense.draft || expense.status === 'saving' || expense.contextCheck) return undefined;
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
  return <SaveBar {...props} amount={amount} />;
});
