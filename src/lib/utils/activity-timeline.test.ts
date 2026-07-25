import { describe, expect, it } from 'vitest';
import {
  formatActivityDetail,
  formatActivityHeadline,
  groupActivitiesByDay,
} from './activity-timeline';

// Build timestamps from local-time components so grouping-by-local-day
// assertions hold in every timezone the test suite runs in.
const localIso = (year: number, month: number, day: number, hour: number) =>
  new Date(year, month - 1, day, hour, 0, 0).toISOString();

describe('activity timeline helpers', () => {
  it('groups activities by calendar day in input order', () => {
    const groups = groupActivitiesByDay([
      {
        _id: '1',
        type: 'expense_added',
        createdAt: localIso(2026, 3, 16, 18),
        actor: { name: 'Alex' },
        metadata: { description: 'Dinner', amount: 1200, currency: 'INR' },
      },
      {
        _id: '2',
        type: 'settlement_recorded',
        createdAt: localIso(2026, 3, 16, 10),
        actor: { name: 'Priya' },
        metadata: { amount: 800, currency: 'INR', paidByName: 'Priya', paidToName: 'Alex' },
      },
      {
        _id: '3',
        type: 'group_created',
        createdAt: localIso(2026, 3, 14, 8),
        actor: { name: 'Alex' },
        metadata: {},
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].activities.map((a) => a._id)).toEqual(['1', '2']);
    expect(groups[1].activities.map((a) => a._id)).toEqual(['3']);
  });

  it('splits activities that fall on different local days', () => {
    const groups = groupActivitiesByDay([
      {
        _id: 'late',
        type: 'expense_added',
        createdAt: localIso(2026, 3, 16, 23),
        actor: { name: 'Alex' },
        metadata: { description: 'Late snack', amount: 100, currency: 'INR' },
      },
      {
        _id: 'early',
        type: 'expense_added',
        createdAt: localIso(2026, 3, 17, 0),
        actor: { name: 'Sam' },
        metadata: { description: 'Midnight cab', amount: 300, currency: 'INR' },
      },
    ]);

    expect(groups).toHaveLength(2);
  });

  it('formats expense and settlement context clearly', () => {
    expect(
      formatActivityHeadline({
        _id: '1',
        type: 'expense_added',
        createdAt: '2026-03-16T18:00:00.000Z',
        actor: { name: 'Alex' },
        metadata: { description: 'Dinner', amount: 1200, currency: 'INR' },
      }),
    ).toContain('Dinner');

    expect(
      formatActivityDetail({
        _id: '2',
        type: 'settlement_recorded',
        createdAt: '2026-03-16T10:00:00.000Z',
        actor: { name: 'Alex' },
        metadata: { paidByName: 'Priya', paidToName: 'Alex', amount: 800, currency: 'INR' },
      }),
    ).toBe('Priya → Alex');
  });
});
