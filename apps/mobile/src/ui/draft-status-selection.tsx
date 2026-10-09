import type { MobileController } from '../data/mobile-controller';
import { expenseDraftChanged } from '../data/expense-draft';
import { DraftStatus } from './draft-status';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';
export function SelectedDraftStatus({ controller }: { controller: MobileController }) {
  const selection = useMobileSnapshot(
    controller,
    ({ expense }) => ({
      persistence: expense.persistence,
      kept:
        !!(expense.attempt || expense.mutation) ||
        (!!expense.draft && expenseDraftChanged(expense.draft, expense.blank)),
    }),
    sameSelection,
  );
  return <DraftStatus {...selection} />;
}
