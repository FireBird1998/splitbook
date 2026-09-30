import { View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { ExpenseEditor } from '../data/expense-draft';
import { receiptScanAvailability } from '../data/receipt-scan';
import { Button, Copy, Label, Panel } from './primitives';
import { fonts, useTheme } from './theme';

/** The development/staging receipt-scanning experiment for a new Expense draft. */
export function ReceiptScanPanel({
  state,
  enabled,
  onScan,
  onApply,
  onDismiss,
}: {
  state: ExpenseEditor;
  enabled: boolean;
  onScan: () => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const availability = receiptScanAvailability(state, enabled);
  if (availability === 'hidden' || !state.draft) return null;
  if (availability === 'inr-only')
    return (
      <Copy style={{ fontSize: 13, color: theme.textSecondary }}>
        Receipt scanning is an experiment for INR Groups only. Enter this amount manually.
      </Copy>
    );
  const scan = state.receiptScan;
  const locked = state.status !== 'editing';
  if (scan.status === 'scanning')
    return (
      <Panel>
        <Copy accessibilityLiveRegion="polite">Reading the receipt on this device…</Copy>
        <Button label="Cancel scan" secondary onPress={onDismiss} />
      </Panel>
    );
  if (scan.status === 'review') {
    const suggested = formatCurrency(toMajorAmount(scan.amountMinor, 'INR'), 'INR');
    const replaces = state.draft.amount.trim() && state.draft.amount !== scan.amount;
    return (
      <Panel>
        <Label>RECEIPT SUGGESTION · EXPERIMENT</Label>
        <Copy
          accessibilityLabel={`Suggested total ${suggested}`}
          style={{ fontFamily: fonts.mono, fontSize: 28, lineHeight: 34 }}
        >
          {suggested}
        </Copy>
        <Copy>
          Read from “{scan.label}” on your receipt. Check it against the receipt before applying.
        </Copy>
        <View style={{ gap: 4 }} accessibilityLabel="Supporting receipt text">
          {scan.evidence.map((row, index) => (
            <Copy
              key={`${index}-${row}`}
              style={{ fontFamily: fonts.mono, fontSize: 13, color: theme.textSecondary }}
            >
              {row}
            </Copy>
          ))}
        </View>
        <Copy style={{ fontSize: 13, color: theme.textSecondary }}>
          {replaces
            ? `Applying replaces the current amount (${state.draft.amount}). `
            : 'Applying sets the amount. '}
          Payers, split, Tag and other details stay as they are. Nothing is saved until you save the
          Expense.
        </Copy>
        <Button label={`Apply ${suggested}`} disabled={locked} onPress={onApply} />
        <Button label="Dismiss suggestion" secondary onPress={onDismiss} />
      </Panel>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {scan.status === 'no-result' && <Copy accessibilityRole="alert">{scan.message}</Copy>}
      <Button
        label={scan.status === 'no-result' ? 'Scan another receipt' : 'Scan receipt'}
        secondary
        disabled={locked}
        onPress={onScan}
      />
      <Copy style={{ fontSize: 13, color: theme.textSecondary }}>
        Experiment: choose a receipt screenshot. It is read on this device and never uploaded.
      </Copy>
    </View>
  );
}
