import { MAX_EXPENSE_AMOUNT, parseAmountMinor } from '@splitbook/shared/exact-money';

/**
 * Selects a payable total from on-device text recognition.
 *
 * A deliberately small port of the payable-receipt-ocr payable policy: payment labels outrank
 * generic totals, and component amounts (subtotals, fees, discounts, wallet deductions) never
 * win. Anything the first slice cannot settle — competing totals, a label without an amount on
 * its row, foreign or missing currency evidence — is an abstention, never a guess. It is not
 * Tesseract parity: there are no multiple passes, arithmetic corroboration or evidence grades.
 */

export interface RecognizedTextLine {
  text: string;
  /** Pixel bounds in the recognized image, when the recognizer reports them. */
  frame: { left: number; top: number; right: number; bottom: number } | null;
}

export interface RecognizedReceipt {
  width: number;
  height: number;
  lines: RecognizedTextLine[];
}

export type ReceiptTotalReading =
  | {
      kind: 'suggestion';
      currency: 'INR';
      amountMinor: number;
      /** The normalized label that identified the amount, e.g. `to pay`. */
      label: string;
      /** Recognized rows supporting the amount, for a person to check. */
      evidence: string[];
    }
  | {
      kind: 'no-suggestion';
      reason:
        | 'no-text'
        | 'no-labelled-total'
        | 'competing-totals'
        | 'unsupported-currency'
        | 'zero-total'
        | 'invalid-amount';
    };

// Label lists follow payable-receipt-ocr's _interpretation.py, in the same precedence.
const NEGATIVE_TOTAL_LABELS = ['total savings', 'total saving', 'total discount'];
const FALLBACK_TOTAL_LABELS = ['total bill amount', 'item total & gst', 'mrp total'];
const PAYMENT_LABELS = [
  'amount paid',
  'paid by you',
  'amount payable',
  'net payable',
  'to pay',
  'amount due',
  'total due',
  'balance due',
  'grand total',
  'order total',
  'bill total',
  'total bill',
  'net amount',
];

const CURRENCY = String.raw`(?:₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP)`;
const NUMBER = String.raw`(?:\d{1,2}(?:,\d{2})+(?:,\d{3})?|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
// Numbered groups (1 prefix, 2 amount, 3 suffix): Hermes leaves `groups` unset on matchAll results.
const MONEY = new RegExp(
  String.raw`(?<!\d)(${CURRENCY})?\s*(${NUMBER})\s*(INR|USD|EUR|GBP)?(?!\d)`,
  'gi',
);
const INR_MARKER = /₹|(?<![A-Za-z0-9])(?:Rs\.?(?![A-Za-z])|INR(?![A-Za-z0-9]))/i;
const FOREIGN_MARKER = /[$€£]|(?<![A-Za-z0-9])(?:USD|EUR|GBP)(?![A-Za-z0-9])/i;

type Label = { kind: 'payment' | 'fallback'; label: string } | null;

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\p{Mn}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function classify(row: string): Label {
  const lowered = row.toLowerCase();
  if (NEGATIVE_TOTAL_LABELS.some((label) => lowered.includes(label))) return null;
  const fallback = FALLBACK_TOTAL_LABELS.find((label) => lowered.includes(label));
  if (fallback) return { kind: 'fallback', label: fallback };
  const payment = PAYMENT_LABELS.find((label) => lowered.includes(label));
  if (payment) return { kind: 'payment', label: payment };
  if (/\btotal\b/.test(lowered) && !/\b(?:sub\s*total|items? total)\b/.test(lowered))
    return { kind: 'fallback', label: 'total' };
  return null;
}

/** Rebuild visual rows: recognizers often split a label from its right-aligned amount. */
function rows(lines: RecognizedTextLine[]): string[] {
  const placed = lines
    .map((line, order) => ({ ...line, text: normalize(line.text), order }))
    .filter((line) => line.text);
  const framed = placed
    .filter((line) => line.frame)
    .sort((a, b) => a.frame!.top - b.frame!.top || a.frame!.left - b.frame!.left);
  const grouped: (typeof framed)[] = [];
  for (const line of framed) {
    const middle = (line.frame!.top + line.frame!.bottom) / 2;
    const row = grouped.find((cells) => {
      const anchor = cells[0].frame!;
      return middle >= anchor.top && middle <= anchor.bottom;
    });
    if (row) row.push(line);
    else grouped.push([line]);
  }
  const framedRows = grouped.map((cells) => ({
    order: Math.min(...cells.map((cell) => cell.order)),
    top: cells[0].frame!.top,
    text: [...cells].sort((a, b) => a.frame!.left - b.frame!.left).map((cell) => cell.text),
  }));
  const loose = placed
    .filter((line) => !line.frame)
    .map((line) => ({ order: line.order, top: Number.NaN, text: [line.text] }));
  return [
    ...framedRows.sort((a, b) => a.top - b.top),
    ...loose.sort((a, b) => a.order - b.order),
  ].map((row) => row.text.join(' '));
}

/** Amounts a labelled row presents: marked or decimal values, plus its right-most value. */
function rowAmounts(row: string): string[] {
  const matches = [...row.matchAll(MONEY)].filter((match) => {
    const after = row.slice((match.index ?? 0) + match[0].length).trimStart();
    return !after.startsWith('%');
  });
  return matches
    .filter(
      (match, index) =>
        index === matches.length - 1 || match[1] || match[3] || match[2].includes('.'),
    )
    .map((match) => match[2].replace(/,/g, ''));
}

export function readPayableTotal(receipt: RecognizedReceipt): ReceiptTotalReading {
  const lines = rows(receipt.lines);
  if (lines.length === 0) return { kind: 'no-suggestion', reason: 'no-text' };
  const candidates: {
    kind: 'payment' | 'fallback';
    label: string;
    row: string;
    amounts: string[];
  }[] = [];
  for (const row of lines) {
    const label = classify(row);
    if (!label) continue;
    const amounts = rowAmounts(row);
    if (amounts.length) candidates.push({ ...label, row, amounts });
  }
  const payment = candidates.filter((candidate) => candidate.kind === 'payment');
  const chosen = payment.length ? payment : candidates;
  if (chosen.length === 0) return { kind: 'no-suggestion', reason: 'no-labelled-total' };
  // This slice reads INR only: any foreign marker, or no INR marker at all, is unsupported.
  if (
    lines.some((line) => FOREIGN_MARKER.test(line)) ||
    !lines.some((line) => INR_MARKER.test(line))
  )
    return { kind: 'no-suggestion', reason: 'unsupported-currency' };

  let minor: number[];
  try {
    minor = chosen.flatMap((candidate) =>
      candidate.amounts.map((amount) => parseAmountMinor(amount, 'INR')),
    );
  } catch {
    return { kind: 'no-suggestion', reason: 'invalid-amount' };
  }
  const distinct = [...new Set(minor)];
  if (distinct.length !== 1) return { kind: 'no-suggestion', reason: 'competing-totals' };
  const [amountMinor] = distinct;
  if (amountMinor === 0) return { kind: 'no-suggestion', reason: 'zero-total' };
  if (amountMinor > parseAmountMinor(MAX_EXPENSE_AMOUNT, 'INR'))
    return { kind: 'no-suggestion', reason: 'invalid-amount' };
  return {
    kind: 'suggestion',
    currency: 'INR',
    amountMinor,
    label: chosen[0].label,
    evidence: chosen.map((candidate) => candidate.row),
  };
}
