import { describe, expect, it } from 'vitest';
import { expenseEditLineText } from '@splitbook/shared/expense-detail';
import type { ActivityEvent } from './activity';
import { describeExpenseEvents, describeExpenseHistory } from './expense-history';
import { inTimeZone } from '../test-utils/time-zone';
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
/** Each edit's lines, as both clients read them (#515). */
const flat = (entries: ReturnType<typeof describeExpenseHistory>) =>
  entries.flatMap((entry) => entry.changes.map(expenseEditLineText));

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
      'Amount ₹3,500.00 → €40.00',
      'Currency INR → EUR',
      'Amount ₹3,200.00 → ₹3,500.00',
    ]);
    expect(entries.map((entry) => entry.summary)).toEqual([
      'Alex edited this Expense',
      'Alex edited this Expense',
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
      'Split By shares → Equally',
      'Alex’s share €30.00 → €20.00',
      'Sam’s share Not included → €20.00',
      'Former member’s share €10.00 → Not included',
    ]);
    // "Not included" is a word, so only the amounts are set in the money font.
    expect(entries[0].changes.map((change) => change.money)).toEqual([
      undefined,
      { before: true, after: true },
      { before: false, after: true },
      { before: true, after: false },
    ]);
    expect(entries[0].summary).toBe('Alex edited this Expense');
  });

  it('names the signed-in member "You" in its edits, beside a namesake (#434)', () => {
    const entries = describeExpenseHistory(
      record([
        edit({
          paidBy: {
            old: [{ user: alex, amount: 40, amountMinor: 4000 }],
            new: [
              { user: alex, amount: 30, amountMinor: 3000 },
              { user: sam, amount: 10, amountMinor: 1000 },
            ],
          },
          splitBetween: {
            old: [{ user: alex, amount: 40, amountMinor: 4000 }],
            new: [
              { user: alex, amount: 20, amountMinor: 2000 },
              { user: sam, amount: 20, amountMinor: 2000 },
            ],
          },
        }),
      ]),
      [{ id: sam, name: 'Alex' }],
      [],
      alex,
    );
    expect(flat(entries)).toEqual([
      'Your payment €40.00 → €30.00',
      'Alex’s payment €0.00 → €10.00',
      'Your share €40.00 → €20.00',
      'Alex’s share Not included → €20.00',
    ]);
    expect(entries[0].summary).toBe('You edited this Expense');
  });

  it('names payments only when the payers or their part of the total changed (#434, #515)', () => {
    const amount = { amount: { old: 1200, new: 1500 }, amountMinor: { old: 120000, new: 150000 } };
    const split = {
      splitBetween: {
        old: [
          { user: alex, amount: 600, amountMinor: 60000 },
          { user: sam, amount: 600, amountMinor: 60000 },
        ],
        new: [
          { user: alex, amount: 750, amountMinor: 75000 },
          { user: sam, amount: 750, amountMinor: 75000 },
        ],
      },
    };
    const paid = (old: [string, number][], next: [string, number][]) => ({
      paidBy: {
        old: old.map(([user, minor]) => ({ user, amount: minor / 100, amountMinor: minor })),
        new: next.map(([user, minor]) => ({ user, amount: minor / 100, amountMinor: minor })),
      },
    });
    const summary = (changes: Record<string, unknown>) =>
      flat(describeExpenseHistory(record([edit(changes)], 'INR'), [], [], alex));
    const raised = 'Amount ₹1,200.00 → ₹1,500.00';
    // One payer, whose payment followed the new total, as the shares did: one line.
    expect(summary({ ...amount, ...paid([[alex, 120000]], [[alex, 150000]]), ...split })).toEqual([
      raised,
    ]);
    // Two payers, each paying the same part of the new total.
    expect(
      summary({
        ...amount,
        ...paid(
          [
            [alex, 80000],
            [sam, 40000],
          ],
          [
            [alex, 100000],
            [sam, 50000],
          ],
        ),
      }),
    ).toEqual([raised]);
    // The same payers, paying different parts of it.
    expect(
      summary({
        ...amount,
        ...paid(
          [
            [alex, 60000],
            [sam, 60000],
          ],
          [
            [alex, 100000],
            [sam, 50000],
          ],
        ),
      }),
    ).toEqual([raised, 'Your payment ₹600.00 → ₹1,000.00', 'Sam’s payment ₹600.00 → ₹500.00']);
    // Someone joined the payers, even for nothing: nobody's amount but the new total's moved.
    expect(
      summary({
        ...amount,
        ...paid(
          [[alex, 120000]],
          [
            [alex, 150000],
            [sam, 0],
          ],
        ),
      }),
    ).toEqual([raised, 'Your payment ₹1,200.00 → ₹1,500.00']);
    // Someone else paid.
    expect(summary({ ...amount, ...paid([[alex, 120000]], [[sam, 150000]]) })).toEqual([
      raised,
      'Sam’s payment ₹0.00 → ₹1,500.00',
      'Your payment ₹1,200.00 → ₹0.00',
    ]);
    // The total stayed, so the payments moved between payers.
    expect(
      summary(
        paid(
          [[alex, 120000]],
          [
            [alex, 60000],
            [sam, 60000],
          ],
        ),
      ),
    ).toEqual(['Your payment ₹1,200.00 → ₹600.00', 'Sam’s payment ₹0.00 → ₹600.00']);
  });

  it('is "edited this Expense", with a line only for what reads differently', () => {
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
    expect(entry.summary).toBe('Alex edited this Expense');
    expect(flat([entry])).toEqual(['Amount €30.00 → €40.00']);
  });

  it('keeps when each edit was made as its ISO timestamp, for the screen to spell (#640)', () => {
    const [entry] = describeExpenseHistory(record([edit({ notes: { old: '', new: 'Aisle' } })]));
    expect(entry.editedAt).toBe(iso);
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
    // The notes' words aren't repeated (#515).
    expect(flat(entries)).toEqual(['Notes changed', 'Notes changed', 'Notes changed']);
  });

  it('shows a changed date as the day it is dated, in a zone behind UTC (#437)', () =>
    inTimeZone('Pacific/Pago_Pago', () => {
      const [entry] = describeExpenseHistory(
        record([
          edit({ date: { old: '2026-08-31T00:00:00.000Z', new: '2026-09-01T00:00:00.000Z' } }),
        ]),
      );
      expect(flat([entry])).toEqual(['Date 31 Aug → 1 Sep']);
    }));

  it('uses labels for dates, categories and Tags, never stored values or references', () => {
    const [entry] = describeExpenseHistory(
      record([
        edit({
          // Stored at midnight UTC, as every Expense date is (#437).
          date: { old: '2026-08-31T00:00:00.000Z', new: '2026-09-01T00:00:00.000Z' },
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
      'Date 31 Aug → 1 Sep',
      'Tag Food → Travel',
      'Category Food & Drink → Transport',
      'Notes changed',
      'Receipt added',
    ]);
    expect(entry.summary).toBe('Alex edited this Expense');
    expect(JSON.stringify(entry)).not.toMatch(/[a-f\d]{24}|https?:/);
  });
});

describe('describeExpenseEvents', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 8, 28, hour)).toISOString();
  const event = (
    type: string,
    metadata: ActivityEvent['metadata'],
    actor: ActivityEvent['actor'] = { _id: alex, name: 'Alex' },
    hour = 12,
  ): ActivityEvent => ({
    _id: `d0000000000000000000000${hour % 10}`,
    group: groupId,
    type,
    actor,
    createdAt: at(hour),
    metadata: { expenseId: 'b00000000000000000000001', ...metadata },
  });
  const lines = (events: ReturnType<typeof describeExpenseEvents>) =>
    events.map((entry) =>
      [`${entry.actor} ${entry.action}`, ...entry.changes.map(expenseEditLineText)].join(' / '),
    );

  it('says who changed what with formatted values, naming the signed-in member "You"', () => {
    const described = describeExpenseEvents(
      [
        event(
          'expense_updated',
          { changes: { amount: { old: 32, new: 40 }, amountMinor: { old: 3200, new: 4000 } } },
          { _id: sam, name: 'Sam Chen' },
          14,
        ),
        event(
          'expense_updated',
          {
            changes: {
              splitBetween: {
                old: [{ user: alex, amount: 30, amountMinor: 3000 }],
                new: [
                  { user: alex, amount: 20, amountMinor: 2000 },
                  { user: sam, amount: 20, amountMinor: 2000 },
                ],
              },
            },
          },
          { _id: alex, name: 'Alex' },
          13,
        ),
        event('expense_added', { description: 'Ferry tickets' }, { _id: sam, name: 'Sam Chen' }),
      ],
      record([]),
      { currentUserId: alex, people: [{ id: sam, name: 'Sam Chen' }] },
    );
    expect(lines(described)).toEqual([
      'Sam Chen edited this Expense / Amount €32.00 → €40.00',
      'You edited this Expense / Your share €30.00 → €20.00 / Sam Chen’s share Not included → €20.00',
      'Sam Chen added this Expense',
    ]);
    expect(described.map((entry) => [entry.name, entry.at])).toEqual([
      ['Sam Chen', at(14)],
      ['Alex', at(13)],
      ['Sam Chen', at(12)],
    ]);
    expect(described[0].changes[0].money).toEqual({ before: true, after: true });
    // "Not included" is a word, not an amount (#151).
    expect(described[1].changes[1]).toMatchObject({
      before: 'Not included',
      money: { before: false, after: true },
    });
  });

  it('says an amount edit whose payer followed the total in one line (#434, #515)', () => {
    const [entry] = describeExpenseEvents(
      [
        event('expense_updated', {
          changes: {
            amount: { old: 1200, new: 1500 },
            amountMinor: { old: 120000, new: 150000 },
            paidBy: {
              old: [{ user: alex, amount: 1200, amountMinor: 120000 }],
              new: [{ user: alex, amount: 1500, amountMinor: 150000 }],
            },
          },
        }),
      ],
      record([], 'INR'),
      { currentUserId: alex },
    );
    expect(`${entry.actor} ${entry.action}`).toBe('You edited this Expense');
    expect(entry.changes.map(expenseEditLineText)).toEqual(['Amount ₹1,200.00 → ₹1,500.00']);
  });

  it('names anyone the event, Group and Expense don’t as a former member, never by reference', () => {
    const described = describeExpenseEvents(
      [
        event('expense_deleted', {}, null, 15),
        event('expense_updated', { action: 'restored' }, { _id: gone }, 14),
        event(
          'expense_updated',
          {
            changes: {
              paidBy: {
                old: [{ user: gone, amount: 40, amountMinor: 4000 }],
                new: [{ user: alex, amount: 40, amountMinor: 4000 }],
              },
              notes: { old: '', new: 'Window seats' },
            },
          },
          { _id: gone },
          13,
        ),
        event('expense_moved', {}, { _id: sam, name: 'Sam' }),
      ],
      record([]),
    );
    expect(lines(described)).toEqual([
      'Former member deleted this Expense',
      'Former member restored this Expense',
      'Former member edited this Expense / Alex’s payment €0.00 → €40.00 / Former member’s payment €40.00 → €0.00 / Notes changed',
      'Sam changed this Expense',
    ]);
    const shown = described.flatMap((entry) => [
      entry.name,
      entry.actor,
      entry.action,
      ...entry.changes.flatMap((change) => [change.label, change.before, change.after]),
    ]);
    expect(shown.join('\n')).not.toMatch(/[a-f\d]{24}|[{}[\]]/);
  });

  it('formats each amount in the currency it had when the edit was made', () => {
    const described = describeExpenseEvents(
      [
        event('expense_updated', { changes: { amount: { old: 40, new: 45 } } }, undefined, 14),
        event(
          'expense_updated',
          { changes: { currency: { old: 'INR', new: 'EUR' }, amount: { old: 3500, new: 40 } } },
          undefined,
          13,
        ),
        event('expense_updated', { changes: { amount: { old: 3200, new: 3500 } } }),
      ],
      record([]),
    );
    expect(lines(described)).toEqual([
      'Alex edited this Expense / Amount €40.00 → €45.00',
      'Alex edited this Expense / Amount ₹3,500.00 → €40.00 / Currency INR → EUR',
      'Alex edited this Expense / Amount ₹3,200.00 → ₹3,500.00',
    ]);
  });

  it('keeps the currency of older events read before the record changed it', () => {
    // A copy of the changes saved before the currency became EUR, beside the current record.
    const saved = record([
      { ...edit({ amount: { old: 20, new: 30 } }), editedAt: at(12) },
      { ...edit({ currency: { old: 'INR', new: 'EUR' } }), editedAt: at(15) },
    ]);
    const described = describeExpenseEvents(
      [event('expense_updated', { changes: { amount: { old: 20, new: 30 } } })],
      saved,
    );
    expect(lines(described)).toEqual(['Alex edited this Expense / Amount ₹20.00 → ₹30.00']);
  });

  it('uses a currency change among the events that the record doesn’t know of yet', () => {
    // A record read before the change to EUR, beside changes read since.
    const described = describeExpenseEvents(
      [
        event('expense_updated', { changes: { amount: { old: 40, new: 45 } } }, undefined, 14),
        event(
          'expense_updated',
          { changes: { currency: { old: 'INR', new: 'EUR' } } },
          undefined,
          13,
        ),
      ],
      record([], 'INR'),
    );
    expect(lines(described)[0]).toBe('Alex edited this Expense / Amount €40.00 → €45.00');
  });
});
