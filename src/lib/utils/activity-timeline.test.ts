import { describe, expect, it } from 'vitest';
import {
  formatActivityDetail,
  formatActivityHeadline,
  groupActivitiesByDay,
} from './activity-timeline';

describe('activity timeline helpers', () => {
  it('groups activities by calendar day in input order', () => {
    const groups = groupActivitiesByDay([
      {
        _id: '1',
        type: 'expense_added',
        createdAt: '2026-03-16T18:00:00.000Z',
        actor: { name: 'Alex' },
        metadata: { description: 'Dinner', amount: 1200, currency: 'INR' },
      },
      {
        _id: '2',
        type: 'settlement_recorded',
        createdAt: '2026-03-16T10:00:00.000Z',
        actor: { name: 'Priya' },
        metadata: { amount: 800, currency: 'INR', paidByName: 'Priya', paidToName: 'Alex' },
      },
      {
        _id: '3',
        type: 'group_created',
        createdAt: '2026-03-14T08:00:00.000Z',
        actor: { name: 'Alex' },
        metadata: {},
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].activities.map((a) => a._id)).toEqual(['1', '2']);
    expect(groups[1].activities.map((a) => a._id)).toEqual(['3']);
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
