import type { MobileController } from '../data/mobile-controller';
import { SplitSheet } from './split-sheet';
import { PayerSheet } from './payer-sheet';
import { useMobileSnapshot } from './use-mobile-snapshot';

export function SelectedSplitSheet({
  controller,
  ...props
}: Parameters<typeof SplitSheet>[0] & { controller: MobileController }) {
  const failed = useMobileSnapshot(controller, ({ expense }) => expense.persistence === 'error');
  return <SplitSheet {...props} persistence={failed ? 'error' : 'saved'} />;
}
export function SelectedPayerSheet({
  controller,
  ...props
}: Parameters<typeof PayerSheet>[0] & { controller: MobileController }) {
  const failed = useMobileSnapshot(controller, ({ expense }) => expense.persistence === 'error');
  return <PayerSheet {...props} persistence={failed ? 'error' : 'saved'} />;
}
