import type { MobileController } from '../data/mobile-controller';
import { SplitSheet } from './split-sheet';
import { PayerSheet } from './payer-sheet';
import { useMobileSnapshot } from './use-mobile-snapshot';

export function SelectedSplitSheet({
  controller,
  ...props
}: Parameters<typeof SplitSheet>[0] & { controller: MobileController }) {
  const persistence = useMobileSnapshot(controller, ({ expense }) => expense.persistence);
  return <SplitSheet {...props} persistence={persistence} />;
}
export function SelectedPayerSheet({
  controller,
  ...props
}: Parameters<typeof PayerSheet>[0] & { controller: MobileController }) {
  const persistence = useMobileSnapshot(controller, ({ expense }) => expense.persistence);
  return <PayerSheet {...props} persistence={persistence} />;
}
