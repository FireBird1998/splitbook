import { memo } from 'react';
import type { MobileController } from '../data/mobile-controller';
import type { ExpenseEditor as Editor } from '../data/expense-draft';
import { ExpenseEditor } from './expense-editor';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

/** Text and storage status belong to their field/status subscribers, outside the task frame. */
function sameFrame(before: Editor, after: Editor) {
  if (before === after) return true;
  if (
    before.status !== 'editing' ||
    after.status !== 'editing' ||
    before.draft?.review?.length ||
    after.draft?.review?.length
  )
    return false;
  const a = before.draft,
    b = after.draft;
  if (!a || !b || (before.persistence === 'error') !== (after.persistence === 'error'))
    return false;
  const sameExcept = <T extends object>(x: T, y: T, ignored: (keyof T)[]) => {
    const keys = (Object.keys(x) as (keyof T)[]).filter((key) => !ignored.includes(key));
    return (
      keys.length === Object.keys(y).filter((key) => !ignored.includes(key as keyof T)).length &&
      keys.every((key) => Object.hasOwn(y, key) && Object.is(x[key], y[key]))
    );
  };
  return (
    sameExcept(before, after, ['draft', 'persistence', 'preview', 'validation']) &&
    sameExcept(a, b, ['amount', 'description', 'notes', 'category']) &&
    (before.validation.submitted
      ? sameSelection(before.validation.errors, after.validation.errors)
      : sameExcept(before.validation.errors, after.validation.errors, ['amount'])) &&
    sameExcept(before.validation, after.validation, ['errors'])
  );
}

export const ControllerExpenseEditor = memo(function ControllerExpenseEditor({
  controller,
  ...props
}: Omit<Parameters<typeof ExpenseEditor>[0], 'state'> & { controller: MobileController }) {
  const state = useMobileSnapshot(controller, (snapshot) => snapshot.expense, sameFrame);
  return <ExpenseEditor {...props} controller={controller} state={state} />;
});
