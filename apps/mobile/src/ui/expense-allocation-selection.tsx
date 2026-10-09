import { memo } from 'react';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { expenseMoney } from '../data/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import { WhoOwesWhat } from './expense-form';
import { useMobileSnapshot } from './use-mobile-snapshot';

type Allocation = ReturnType<typeof expenseMoney>;
/** Text spelling can change while the exact allocation shown stays the same. */
const sameAllocation = (a: Allocation | null, b: Allocation | null) => {
  if (!a || !b) return a === b;
  const rows = (x: Allocation['paidBy'], y: Allocation['paidBy']) =>
    x.length === y.length &&
    x.every((row, index) => row.user === y[index].user && row.amountMinor === y[index].amountMinor);
  return (
    a.amountMinor === b.amountMinor &&
    rows(a.paidBy, b.paidBy) &&
    rows(a.splitBetween, b.splitBetween)
  );
};
export const SelectedWhoOwesWhat = memo(function SelectedWhoOwesWhat({
  controller,
  ...props
}: Pick<Parameters<typeof WhoOwesWhat>[0], 'name' | 'currentUserId'> & {
  controller: MobileController;
}) {
  const { draft, allocation, problem } = useMobileSnapshot(
    controller,
    ({ expense }) => {
      const draft = expense.draft!;
      let allocation: Allocation | null = null;
      let problem = '';
      try {
        allocation = expenseMoney(draft);
      } catch (cause) {
        problem = cause instanceof Error ? cause.message : 'Review the allocation.';
      }
      return {
        draft,
        allocation,
        problem: expense.validation.errors.amount
          ? 'Correct the amount to see who owes what.'
          : draft.amount
            ? problem
            : 'Enter a valid amount to see who owes what.',
      };
    },
    (a, b) =>
      a.problem === b.problem &&
      a.draft.currency === b.draft.currency &&
      a.draft.splitMethod === b.draft.splitMethod &&
      sameAllocation(a.allocation, b.allocation),
  );
  return (
    <WhoOwesWhat
      {...props}
      draft={draft}
      allocation={allocation}
      money={(minor) => formatCurrency(toMajorAmount(minor, draft.currency), draft.currency)}
      problem={problem}
    />
  );
});
