import { memo } from 'react';
import { View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { MobileController } from '../data/mobile-controller';
import { receiptScanAvailability } from '../data/receipt-scan';
import { Card, CompactButton, CompactText, Money } from './compact';
import { fonts } from './theme';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

/**
 * The development/staging receipt-scanning experiment for a new Expense draft. It subscribes on
 * its own, outside the task frame, so its review follows the draft's amount as it is typed.
 */
export const ReceiptScanPanel = memo(function ReceiptScanPanel({
  controller,
}: {
  controller: MobileController;
}) {
  const { availability, scan, amount, locked } = useMobileSnapshot(
    controller,
    ({ expense }) => ({
      availability: receiptScanAvailability(expense, controller.receiptScanEnabled),
      scan: expense.receiptScan,
      amount: expense.draft?.amount ?? '',
      locked: expense.status !== 'editing',
    }),
    sameSelection,
  );
  if (availability === 'hidden') return null;
  if (availability === 'inr-only')
    return (
      <CompactText variant="small" tone="secondary">
        Receipt scanning is an experiment for INR Groups only. Enter this amount manually.
      </CompactText>
    );
  if (scan.status === 'scanning')
    return (
      <Card padded>
        <View style={{ gap: 10 }}>
          <CompactText accessibilityLiveRegion="polite">
            Reading the receipt on this device…
          </CompactText>
          <CompactButton
            label="Cancel scan"
            variant="tonal"
            dense
            onPress={controller.dismissReceiptScan}
          />
        </View>
      </Card>
    );
  if (scan.status === 'review') {
    const suggested = formatCurrency(toMajorAmount(scan.amountMinor, 'INR'), 'INR');
    const replaces = amount.trim() && amount !== scan.amount;
    return (
      <Card padded>
        <View style={{ gap: 10 }}>
          <CompactText variant="overline">Receipt suggestion · experiment</CompactText>
          <Money size="form" accessibilityLabel={`Suggested total ${suggested}`}>
            {suggested}
          </Money>
          <CompactText>
            Read from “{scan.label}” on your receipt. Check it against the receipt before applying.
          </CompactText>
          <View style={{ gap: 4 }} accessibilityLabel="Supporting receipt text">
            {scan.evidence.map((row, index) => (
              <CompactText
                key={`${index}-${row}`}
                variant="small"
                tone="secondary"
                style={{ fontFamily: fonts.mono }}
              >
                {row}
              </CompactText>
            ))}
          </View>
          <CompactText variant="small" tone="secondary">
            {replaces
              ? `Applying replaces the current amount (${amount}). `
              : 'Applying sets the amount. '}
            Payers, split, Tag and other details stay as they are. Nothing is saved until you save
            the Expense.
          </CompactText>
          <CompactButton
            label={`Apply ${suggested}`}
            disabled={locked}
            onPress={() => void controller.applyReceiptScan()}
          />
          <CompactButton
            label="Dismiss suggestion"
            variant="text"
            dense
            onPress={controller.dismissReceiptScan}
          />
        </View>
      </Card>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {scan.status === 'no-result' && (
        <CompactText accessibilityRole="alert">{scan.message}</CompactText>
      )}
      <CompactButton
        label={scan.status === 'no-result' ? 'Scan another receipt' : 'Scan receipt'}
        variant="tonal"
        dense
        disabled={locked}
        onPress={() => void controller.scanReceipt()}
      />
      <CompactText variant="small" tone="secondary">
        Experiment: choose a receipt screenshot. It is read on this device and never uploaded.
      </CompactText>
    </View>
  );
});
