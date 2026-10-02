import { describe, expect, it } from 'vitest';
import { describeExpenseHistory } from './expense-history';
import { expenseRecordSchema, type ExpenseRecord } from './expense-record';

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const gone = 'a00000000000000000000099';
const groupId = 'a00000000000000000000010';
const iso = '2026-09-28T10:00:00.000Z';

function record(editHistory: unknown[], currency = 'EUR'): ExpenseRecord {
  return expenseRecordSchema.parse({
    _id: 'b00000000000000000000001',
    group: groupId,
    revision: editHistory.length,
    description: 'Ferry tickets',
    amount: 40,
    amountMinor: 4000,
    moneyVersion: 1,
    currency,
    paidBy: [{ user: { _id: alex, name: 'Alex' }, amount: 40, amountMinor: 4000 }],
    splitBetween: [
      { user: { _id: alex, name: 'Alex' }, amount: 20, amountMinor: 2000 },
      { user: { _id: sam, name: 'Sam' }, amount: 20, amountMinor: 2000 },
    ],
    splitMethod: 'equal',
    date: iso,
    createdAt: iso,
    updatedAt: iso,
    category: 'transport',
    tag: 'Travel',
    notes: '',
    isDeleted: false,
    editHistory,
  });
}
const edit = (
  changes: Record<string, unknown>,
  editedBy: unknown = { _id: alex, name: 'Alex' },
) => ({
  editedBy,
  editedAt: iso,
  changes,
});
const flat = (entries: ReturnType<typeof describeExpenseHistory>) =>
  entries.flatMap((entry) =>
    entry.changes.map((change) => [change.label, change.before, change.after].join(' | ')),
  );

describe('describeExpenseHistory', () => {
  it('formats each amount in the currency it had when the edit was made', () => {
    const entries = describeExpenseHistory(
      record([
        edit({ amount: { old: 3200, new: 3500 } }),
        edit({
          currency: { old: 'INR', new: 'EUR' },
          amount: { old: 3500, new: 40 },
          amountMinor: { old: 350000, new: 4000 },
        }),
      ]),
    );
    expect(flat(entries)).toEqual([
      'Currency | INR | EUR',
      'Amount | ₹3,500.00 | €40.00',
      'Amount | ₹3,200.00 | ₹3,500.00',
    ]);
    expect(entries.map((entry) => entry.summary)).toEqual([
      'Alex changed the currency and the amount',
      'Alex changed the amount',
    ]);
  });

  it('describes who joined, left or changed their share by name', () => {
    const entries = describeExpenseHistory(
      record([
        edit({
          splitMethod: { old: 'shares', new: 'equal' },
          splitBetween: {
            old: [
              { user: alex, amount: 30, amountMinor: 3000 },
              { user: gone, amount: 10, amountMinor: 1000 },
            ],
            new: [
              { user: alex, amount: 20, amountMinor: 2000 },
              { user: sam, amount: 20, amountMinor: 2000 },
            ],
          },
        }),
      ]),
    );
    expect(flat(entries)).toEqual([
      'Split method | Shares | Equal',
      'Alex’s share | €30.00 | €20.00',
      'Sam’s share | Not included | €20.00',
      'Former member’s share | €10.00 | Not included',
    ]);
    // "Not included" is a word, so only the amounts are set in the money font.
    expect(entries[0].changes.map((change) => change.money)).toEqual([
      undefined,
      { before: true, after: true },
      { before: false, after: true },
      { before: true, after: false },
    ]);
    expect(entries[0].summary).toBe('Alex changed the split');
  });

  it('lists up to four changed details in the summary', () => {
    const [entry] = describeExpenseHistory(
      record([
        edit({
          amount: { old: 30, new: 40 },
          amountMinor: { old: 3000, new: 4000 },
          moneyVersion: { old: 1, new: 1 },
          date: { old: iso, new: iso },
          paidBy: { old: [], new: [] },
          splitBetween: { old: [], new: [] },
        }),
      ]),
    );
    expect(entry.summary).toBe('Alex changed the amount, the date, who paid and the split');
  });

  it('names editors from the Group, and anyone it no longer names as a former member', () => {
    const entries = describeExpenseHistory(
      record([
        edit({ notes: { old: '', new: 'Window seats' } }, sam),
        edit({ notes: { old: 'Window seats', new: '' } }, gone),
        edit({ notes: { old: '', new: 'Aisle' } }, null),
      ]),
      [{ id: sam, name: 'Sam Chen' }],
    );
    expect(entries.map((entry) => entry.editor)).toEqual([
      'Former member',
      'Former member',
      'Sam Chen',
    ]);
    expect(flat(entries)).toEqual([
      'Notes | None | “Aisle”',
      'Notes | “Window seats” | None',
      'Notes | None | “Window seats”',
    ]);
  });

  it('uses labels for dates, categories and Tags, never stored values or references', () => {
    const [entry] = describeExpenseHistory(
      record([
        edit({
          // Stored at local noon, as the app saves dates.
          date: {
            old: new Date(2026, 7, 31, 12).toISOString(),
            new: new Date(2026, 8, 1, 12).toISOString(),
          },
          category: { old: 'food', new: 'transport' },
          tagId: { old: 'c00000000000000000000001', new: 'c00000000000000000000002' },
          receiptUrl: { old: null, new: 'https://example.test/receipt.png' },
          notes: { old: 'Aisle', new: 'Aisle seats' },
        }),
      ]),
      [],
      [
        { id: 'c00000000000000000000001', name: 'Food' },
        { id: 'c00000000000000000000002', name: 'Travel' },
      ],
    );
    expect(flat([entry])).toEqual([
      'Date | Aug 31, 2026 | Sep 1, 2026',
      'Category | Food & Drink | Transport',
      'Tag | Food | Travel',
      'Receipt |  | Added',
      'Notes | “Aisle” | “Aisle seats”',
    ]);
    expect(entry.summary).toBe('Alex changed 5 details');
    expect(JSON.stringify(entry)).not.toMatch(/[a-f\d]{24}|https?:/);
  });
});
