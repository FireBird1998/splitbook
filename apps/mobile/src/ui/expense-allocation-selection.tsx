import { memo } from 'react';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { expenseMoney, type ExpenseDraft } from '../data/expense-draft';
import type { MobileController } from '../data/mobile-controller';
import { WhoOwesWhat } from './expense-form';
import { useMobileSnapshot } from './use-mobile-snapshot';

const moneyFields: (keyof ExpenseDraft)[] = [
  'original',
  'amount',
  'currency',
  'multiPayer',
  'payerId',
  'payers',
  'participantIds',
  'splitMethod',
  'splitValues',
];
export const SelectedWhoOwesWhat = memo(function SelectedWhoOwesWhat({
  controller,
  ...props
}: Pick<Parameters<typeof WhoOwesWhat>[0], 'name' | 'currentUserId'> & {
  controller: MobileController;
}) {
  const { draft, error } = useMobileSnapshot(
    controller,
    ({ expense }) => ({
      draft: expense.draft!,
      error: expense.validation.errors.amount,
    }),
    (a, b) =>
      a.error === b.error &&
      moneyFields.every((field) => Object.is(a.draft[field], b.draft[field])),
  );
  let allocation: ReturnType<typeof expenseMoney> | null = null;
  let problem = '';
  try {
    allocation = expenseMoney(draft);
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : 'Review the allocation.';
  }
  return (
    <WhoOwesWhat
      {...props}
      draft={draft}
      allocation={allocation}
      money={(minor) => formatCurrency(toMajorAmount(minor, draft.currency), draft.currency)}
      problem={
        error
          ? 'Correct the amount to see who owes what.'
          : draft.amount
            ? problem
            : 'Enter a valid amount to see who owes what.'
      }
    />
  );
});
