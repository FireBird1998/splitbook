import type { MobileController } from '../data/mobile-controller';
import type { ExpenseDraft } from '../data/expense-draft';
import { SplitSheet } from './split-sheet';
import { PayerSheet } from './payer-sheet';
import { useMobileSnapshot } from './use-mobile-snapshot';

const fields: (keyof ExpenseDraft)[] = [
  'amount',
  'currency',
  'original',
  'multiPayer',
  'payerId',
  'payers',
  'participantIds',
  'splitMethod',
  'splitValues',
];
function useSheetEntries(controller: MobileController) {
  return useMobileSnapshot(
    controller,
    ({ expense }) => ({
      draft: expense.draft!,
      failed: expense.persistence === 'error',
    }),
    (a, b) => a.failed === b.failed && fields.every((key) => Object.is(a.draft[key], b.draft[key])),
  );
}

export function SelectedSplitSheet({
  controller,
  ...props
}: Parameters<typeof SplitSheet>[0] & { controller: MobileController }) {
  const { draft, failed } = useSheetEntries(controller);
  return <SplitSheet {...props} draft={draft} persistence={failed ? 'error' : 'saved'} />;
}
export function SelectedPayerSheet({
  controller,
  ...props
}: Parameters<typeof PayerSheet>[0] & { controller: MobileController }) {
  const { draft, failed } = useSheetEntries(controller);
  return <PayerSheet {...props} draft={draft} persistence={failed ? 'error' : 'saved'} />;
}
