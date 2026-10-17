import { toMajorAmount } from '@splitbook/shared/exact-money';
import {
  readPayableTotal,
  type RecognizedReceipt,
  type ReceiptTotalReading,
} from './receipt-total';
import type { ExpenseEditor } from './expense-draft';

/**
 * Platform adapter for the receipt-scanning experiment: a person chooses one local image and
 * its text is recognized on this device. Implementations must not upload pixels or text, log
 * them, or delete the person's original image.
 */
export interface ReceiptScanner {
  /** Null when the person cancels choosing an image. Rejects when the image cannot be read. */
  scan(): Promise<RecognizedReceipt | null>;
}

/** Memory-only review state. Receipt text is never written to draft storage. */
export type ReceiptScanState =
  | { status: 'idle'; message: string | null }
  | { status: 'scanning'; scanId: number }
  | {
      status: 'review';
      scanId: number;
      /** Draft-ready amount text for the suggested total. */
      amount: string;
      amountMinor: number;
      label: string;
      evidence: string[];
      /** The draft amount when the scan started; Apply never overwrites a later edit. */
      baseAmount: string;
    }
  | { status: 'no-result'; message: string };

export const idleReceiptScan: ReceiptScanState = { status: 'idle', message: null };

export const receiptScanMessages = {
  failed: 'Couldn’t read that image on this device. Your draft hasn’t changed.',
  stale:
    'The amount changed after this scan, so the receipt amount wasn’t applied. Scan again to use it.',
} as const;

const noSuggestion: Record<
  Extract<ReceiptTotalReading, { kind: 'no-suggestion' }>['reason'],
  string
> = {
  'no-text': 'No text was found in that image. Enter the amount manually.',
  'no-labelled-total': 'No clearly labelled total was found. Enter the amount manually.',
  'competing-totals':
    'The receipt shows more than one possible total, so no amount was suggested. Enter the amount manually.',
  'unsupported-currency':
    'No INR marker (₹, Rs. or INR) was recognized, or another currency appeared, so no amount was suggested. Enter the amount manually.',
  'zero-total': 'The receipt total is zero, so no amount was suggested.',
  'invalid-amount': 'The total couldn’t be read as a valid amount. Enter the amount manually.',
};

/** Where scanning applies: new drafts in INR Groups, while the experiment is enabled. */
export function receiptScanAvailability(
  editor: ExpenseEditor,
  enabled: boolean,
): 'hidden' | 'inr-only' | 'available' {
  if (!enabled || !editor.draft || editor.draft.original) return 'hidden';
  const groupCurrency = editor.context?.group.defaultCurrency ?? editor.draft.currency;
  return groupCurrency === 'INR' && editor.draft.currency === 'INR' ? 'available' : 'inr-only';
}

/** Choose, recognize and interpret one image. Never throws; never touches the draft. */
export async function runReceiptScan(
  scanner: ReceiptScanner,
  scanId: number,
  baseAmount: string,
): Promise<ReceiptScanState> {
  let recognized: RecognizedReceipt | null;
  try {
    recognized = await scanner.scan();
  } catch {
    return { status: 'no-result', message: receiptScanMessages.failed };
  }
  if (!recognized) return idleReceiptScan;
  let reading: ReceiptTotalReading;
  try {
    reading = readPayableTotal(recognized);
  } catch {
    return { status: 'no-result', message: receiptScanMessages.failed };
  }
  if (reading.kind === 'no-suggestion')
    return { status: 'no-result', message: noSuggestion[reading.reason] };
  return {
    status: 'review',
    scanId,
    amount: String(toMajorAmount(reading.amountMinor, reading.currency)),
    amountMinor: reading.amountMinor,
    label: reading.label,
    evidence: reading.evidence,
    baseAmount,
  };
}
