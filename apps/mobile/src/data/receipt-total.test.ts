import { describe, expect, it } from 'vitest';
import { readPayableTotal, type RecognizedReceipt } from './receipt-total';

/** Build recognized text as rows: each row's cells share a line, left to right. */
function receipt(...rows: string[][]): RecognizedReceipt {
  const lines = rows.flatMap((cells, row) =>
    cells.map((text, column) => ({
      text,
      frame: {
        left: 40 + column * 500,
        top: 100 + row * 60,
        right: 400 + column * 500,
        bottom: 140 + row * 60,
      },
    })),
  );
  return { width: 1080, height: 100 + rows.length * 60 + 100, lines };
}

describe('readPayableTotal', () => {
  it('suggests a single explicitly labelled INR payable total from its row', () => {
    const reading = readPayableTotal(
      receipt(['Item total', '₹310.00'], ['Delivery fee', '₹25'], ['To Pay', '₹289.86']),
    );
    expect(reading).toEqual({
      kind: 'suggestion',
      currency: 'INR',
      amountMinor: 28986,
      label: 'to pay',
      evidence: ['To Pay ₹289.86'],
    });
  });

  it('joins a label and its right-aligned amount recognized as separate lines', () => {
    const lines = [
      { text: 'Grand Total', frame: { left: 40, top: 500, right: 300, bottom: 540 } },
      { text: 'Rs. 1,249.50', frame: { left: 780, top: 503, right: 1040, bottom: 541 } },
      { text: 'Thank you', frame: { left: 40, top: 600, right: 300, bottom: 640 } },
    ];
    expect(readPayableTotal({ width: 1080, height: 800, lines })).toMatchObject({
      kind: 'suggestion',
      amountMinor: 124950,
      label: 'grand total',
      evidence: ['Grand Total Rs. 1,249.50'],
    });
  });

  it('reads Indian digit grouping and whole-rupee totals exactly', () => {
    expect(readPayableTotal(receipt(['Amount payable', 'INR 1,23,456']))).toMatchObject({
      kind: 'suggestion',
      amountMinor: 12345600,
    });
  });

  it('lets agreeing payment labels support one amount', () => {
    expect(
      readPayableTotal(receipt(['Grand total', '₹320'], ['Paid by you', '₹320.00'])),
    ).toMatchObject({
      kind: 'suggestion',
      amountMinor: 32000,
      evidence: ['Grand total ₹320', 'Paid by you ₹320.00'],
    });
  });

  it('prefers a payment label over a generic total, as the Tesseract contract does', () => {
    expect(
      readPayableTotal(receipt(['Total', '₹350'], ['Wallet', '-₹30'], ['To pay', '₹320'])),
    ).toMatchObject({ kind: 'suggestion', amountMinor: 32000, label: 'to pay' });
  });

  it('uses a lone generic total when no payment label is present', () => {
    expect(readPayableTotal(receipt(['Subtotal', '₹300'], ['Total', '₹318']))).toMatchObject({
      kind: 'suggestion',
      amountMinor: 31800,
      label: 'total',
    });
  });

  it('abstains when payment labels disagree', () => {
    expect(readPayableTotal(receipt(['Bill total', '₹350'], ['To pay', '₹320']))).toEqual({
      kind: 'no-suggestion',
      reason: 'competing-totals',
    });
  });

  it('abstains when one labelled row shows competing amounts', () => {
    expect(readPayableTotal(receipt(['To pay', '₹350 ₹320']))).toEqual({
      kind: 'no-suggestion',
      reason: 'competing-totals',
    });
  });

  it('abstains when generic totals disagree and no payment label settles them', () => {
    expect(readPayableTotal(receipt(['Total', '₹350'], ['Total', '₹320']))).toEqual({
      kind: 'no-suggestion',
      reason: 'competing-totals',
    });
  });

  it('ignores component amounts, savings and percentages', () => {
    expect(
      readPayableTotal(
        receipt(
          ['Item total', '₹400'],
          ['Discount 10%', '-₹40'],
          ['Total savings', '₹40'],
          ['GST', '₹18'],
        ),
      ),
    ).toEqual({ kind: 'no-suggestion', reason: 'no-labelled-total' });
  });

  it('abstains on a zero payable total', () => {
    expect(readPayableTotal(receipt(['To pay', '₹0.00']))).toEqual({
      kind: 'no-suggestion',
      reason: 'zero-total',
    });
  });

  it('abstains on foreign or missing currency evidence', () => {
    expect(readPayableTotal(receipt(['Total', '$42.10']))).toEqual({
      kind: 'no-suggestion',
      reason: 'unsupported-currency',
    });
    expect(readPayableTotal(receipt(['Grand total', '₹320'], ['Tip', 'USD 5']))).toEqual({
      kind: 'no-suggestion',
      reason: 'unsupported-currency',
    });
    expect(readPayableTotal(receipt(['Total', '320.00']))).toEqual({
      kind: 'no-suggestion',
      reason: 'unsupported-currency',
    });
  });

  it('accepts an INR marker elsewhere on the receipt when the total row omits it', () => {
    expect(
      readPayableTotal(receipt(['Item total', '₹300.00'], ['Grand total', '300.00'])),
    ).toMatchObject({ kind: 'suggestion', amountMinor: 30000 });
  });

  it('abstains on amounts above the Expense limit', () => {
    expect(readPayableTotal(receipt(['To pay', '₹10,000,000.01']))).toEqual({
      kind: 'no-suggestion',
      reason: 'invalid-amount',
    });
  });

  it('reports empty recognition separately from a receipt without a total', () => {
    expect(readPayableTotal({ width: 100, height: 100, lines: [] })).toEqual({
      kind: 'no-suggestion',
      reason: 'no-text',
    });
    expect(readPayableTotal(receipt(['Thank you for shopping']))).toEqual({
      kind: 'no-suggestion',
      reason: 'no-labelled-total',
    });
  });

  it('does not read a label on one row with the amount on the next', () => {
    expect(readPayableTotal(receipt(['To pay'], ['₹289.86']))).toEqual({
      kind: 'no-suggestion',
      reason: 'no-labelled-total',
    });
  });

  it('keeps lines without geometry as separate rows in recognized order', () => {
    const lines = [
      { text: 'Order summary', frame: null },
      { text: 'To pay ₹120.50', frame: null },
    ];
    expect(readPayableTotal({ width: 0, height: 0, lines })).toMatchObject({
      kind: 'suggestion',
      amountMinor: 12050,
      evidence: ['To pay ₹120.50'],
    });
  });
});
