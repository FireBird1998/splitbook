import type { MobileController } from '../data/mobile-controller';
import {
  AmountField,
  DescriptionField,
  NotesField,
  type ExpenseInputProps,
} from './expense-inputs';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';
export function SelectedNotesField({
  controller,
  ...props
}: Omit<Parameters<typeof NotesField>[0], 'notes'> & { controller: MobileController }) {
  const notes = useMobileSnapshot(controller, ({ expense }) => expense.draft?.notes ?? '');
  return <NotesField {...props} notes={notes} />;
}
export function SelectedAmountField({
  controller,
  ...props
}: ExpenseInputProps & { controller: MobileController }) {
  const selected = useMobileSnapshot(
    controller,
    ({ expense }) => ({
      amount: expense.draft?.amount ?? '',
      currency: expense.draft?.currency ?? '',
      original: expense.draft?.original,
      error: expense.validation.errors.amount,
    }),
    sameSelection,
  );
  return (
    <AmountField
      {...props}
      draft={{ ...props.draft, ...selected }}
      errors={{ amount: selected.error }}
    />
  );
}
export function SelectedDescriptionField({
  controller,
  ...props
}: ExpenseInputProps & { controller: MobileController }) {
  const selected = useMobileSnapshot(
    controller,
    ({ expense }) => ({
      description: expense.draft?.description ?? '',
      error: expense.validation.errors.description,
    }),
    sameSelection,
  );
  return (
    <DescriptionField
      {...props}
      draft={{ ...props.draft, description: selected.description }}
      errors={{ description: selected.error }}
    />
  );
}
