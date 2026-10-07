import { describe, expect, it } from 'vitest';
import { backupSchema, buildBackup } from './export-backup';
import type { ExportExpense } from './export-csv';

const expense: ExportExpense = {
  id: 'e1',
  date: '2026-09-01T00:00:00.000Z',
  description: 'Lunch',
  category: 'food',
  tag: 'Meals',
  currency: 'INR',
  amountMinor: 101,
  splitMethod: 'equal',
  paidBy: [{ userId: 'a', amountMinor: 101 }],
  splitBetween: [
    { userId: 'a', amountMinor: 51 },
    { userId: 'b', amountMinor: 50 },
  ],
};
const group = {
  id: 'g1',
  name: 'Ferry Trip',
  theme: 'trip' as const,
  currency: 'INR',
  members: [{ id: 'a', name: 'Alice' }],
  names: { a: 'Alice', b: 'Bob' },
  tags: [],
  expenses: [expense],
  settlements: [],
};
const at = '2026-10-01T00:00:00.000Z';
describe('JSON backup', () => {
  it('round-trips exact minor units and includes a named former member', () => {
    const result = backupSchema.parse(buildBackup([group], { exportedAt: at, include: [] }));
    expect(result.format).toBe('splitbook-backup/1');
    expect(result.groups[0].expenses[0].amountMinor).toBe(101);
    expect(result.groups[0].expenses[0].splitBetween.map((row) => row.amountMinor)).toEqual([
      51, 50,
    ]);
    expect(result.groups[0].members).toEqual([
      { id: 'a', name: 'Alice', former: false },
      { id: 'b', name: 'Bob', former: true },
    ]);
  });
  it('projects contact-free identities even in populated history and free text', () => {
    const result = buildBackup(
      [
        {
          ...group,
          name: 'Trip owner@example.test',
          names: { a: 'Alice', b: 'Bob' },
          expenses: [
            {
              ...expense,
              notes: 'Reach me at bob@example.test',
              edits: [
                {
                  at,
                  byId: 'b',
                  changes: {
                    paidBy: {
                      old: [
                        {
                          user: { _id: 'b', name: 'Bob', email: 'bob@example.test' },
                          amount: 1.01,
                        },
                      ],
                      new: [],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      { exportedAt: at, include: ['history'] },
    );
    expect(JSON.stringify(result)).not.toMatch(/email|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(result.groups[0].expenses[0].edits?.[0].changes.paidBy.old).toEqual([
      { user: 'b', amount: 1.01 },
    ]);
  });
  it('keeps legacy currencies separate and orders Groups and records deterministically', () => {
    const euro = {
      ...expense,
      id: 'e2',
      currency: 'EUR',
      amountMinor: 3,
      paidBy: [{ userId: 'a', amountMinor: 3 }],
      splitBetween: [{ userId: 'b', amountMinor: 3 }],
    };
    const first = { ...group, expenses: [euro, expense] };
    const second = { ...group, id: 'g2', expenses: [] };
    const result = buildBackup([second, first], { exportedAt: at, include: [] });
    expect(result).toEqual(
      buildBackup([{ ...first, expenses: [expense, euro] }, second], {
        exportedAt: at,
        include: [],
      }),
    );
    expect(result.groups[0].expenses.map((row) => [row.currency, row.amountMinor])).toEqual([
      ['INR', 101],
      ['EUR', 3],
    ]);
  });
});
