import { describe, expect, it } from 'vitest';
import { ledgerItems } from './ledger-items';

describe('a Group ledger’s flattened day and row order (#179)', () => {
  it('keeps row identities when newer rows arrive, with distinct day headings', () => {
    const days = [
      { key: '2026-10-11', label: 'Today', rows: [{ id: 'lunch' }, { id: 'train' }] },
      { key: '2026-10-10', label: 'Saturday', rows: [{ id: 'rent' }] },
    ];
    const items = ledgerItems(days, (row) => row.id);
    expect(items.map(({ key }) => key)).toEqual([
      'day:2026-10-11',
      'lunch',
      'train',
      'day:2026-10-10',
      'rent',
    ]);
    expect(items.map(({ first, last }) => [first, last])).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, false],
      [false, true],
    ]);
    const newer = ledgerItems(
      [{ ...days[0], rows: [{ id: 'breakfast' }, ...days[0].rows] }, days[1]],
      (row) => row.id,
    );
    expect(newer.find(({ key }) => key === 'train')).toEqual(items[2]);
    expect(ledgerItems([], (row: { id: string }) => row.id)).toEqual([]);
  });
});
