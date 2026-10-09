import { memo } from 'react';
import type { MobileController } from '../data/mobile-controller';
import { OptionalDetails } from './expense-form';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';
export const SelectedOptionalDetails = memo(function SelectedOptionalDetails({
  controller,
  ...props
}: Omit<Parameters<typeof OptionalDetails>[0], 'draft'> & { controller: MobileController }) {
  const draft = useMobileSnapshot(
    controller,
    ({ expense }) => ({
      notes: expense.draft!.notes,
      category: expense.draft!.category,
    }),
    sameSelection,
  );
  return <OptionalDetails {...props} draft={draft} />;
});
