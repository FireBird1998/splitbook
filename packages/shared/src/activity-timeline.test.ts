import { describe, expect, it } from 'vitest';
import {
  activityLineParts,
  formatActivityAmount,
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

  it.each([
    ['removed', 'Alex removed a member from the group'],
    ['left', 'Alex left the group'],
  ])('distinguishes membership action %s from the actor leaving', (method, expected) => {
    expect(
      formatActivityHeadline({
        _id: 'membership',
        type: 'member_left',
        createdAt: '2026-09-28T12:00:00.000Z',
        actor: { name: 'Alex' },
        metadata: { userId: 'sam', method },
      }),
    ).toBe(expected);
  });

  it('marks recurring-generated expenses in the headline', () => {
    expect(
      formatActivityHeadline({
        _id: '1',
        type: 'expense_added',
        createdAt: '2026-08-01T00:00:00.000Z',
        actor: { name: 'Alex' },
        metadata: { description: 'Rent', amount: 30000, currency: 'INR', recurring: true },
      }),
    ).toBe('Alex added “Rent” (recurring)');
  });
});

describe("Home's latest changes (#309)", () => {
  const priya = { _id: 'a00000000000000000000003', name: 'Priya Shah' };
  const at = '2026-10-06T14:10:00.000Z';
  const event = (type: string, metadata: Record<string, unknown>, actor = priya) => ({
    _id: 'e1',
    type,
    createdAt: at,
    actor,
    metadata,
  });

  it.each([
    ['expense_added', { description: 'Weekly groceries' }, 'added', 'Weekly groceries'],
    ['expense_updated', { description: 'Wi-Fi', changes: {} }, 'edited', 'Wi-Fi'],
    ['expense_updated', { description: 'Wi-Fi', action: 'restored' }, 'restored', 'Wi-Fi'],
    ['expense_deleted', { description: 'Duplicate groceries' }, 'deleted', 'Duplicate groceries'],
    ['expense_added', {}, 'added', 'an Expense'],
    ['settlement_recorded', { amount: 500, currency: 'INR' }, 'recorded a payment', null],
    ['member_joined', { method: 'invite' }, 'joined the Group', null],
    ['member_left', { method: 'left' }, 'left the Group', null],
    ['member_left', { method: 'removed' }, 'removed a member', null],
    ['group_created', { groupName: 'Maple House' }, 'created the Group', null],
    ['group_updated', { changes: { name: {} } }, 'updated the Group', null],
    ['something_new', {}, 'made a change', null],
  ])('says who did what: %s %j', (type, metadata, action, subject) => {
    expect(activityLineParts(event(type, metadata))).toEqual({
      actor: 'Priya Shah',
      action,
      subject,
    });
  });

  it('calls the viewer "You", and anyone without a name "Someone"', () => {
    const added = event('expense_added', { description: 'Rent' });
    expect(activityLineParts(added, priya._id).actor).toBe('You');
    expect(activityLineParts(added, 'a00000000000000000000001').actor).toBe('Priya Shah');
    expect(activityLineParts({ ...added, actor: null }, priya._id).actor).toBe('Someone');
    expect(activityLineParts({ ...added, actor: { _id: 'x', name: '  ' } }).actor).toBe('Someone');
  });

  it('never marks a recurring Expense, which recurring Expenses switched off would hide', () => {
    const line = activityLineParts(
      event('expense_added', { description: 'Rent', recurring: true }),
    );
    expect(Object.values(line).join(' ')).not.toMatch(/recurring/i);
  });

  it('gives an added or deleted Expense, and a payment, its recorded amount', () => {
    expect(
      formatActivityAmount(event('expense_added', { amount: 1249.5, currency: 'INR' })),
    ).toEqual({ after: '₹1,249.50' });
    expect(
      formatActivityAmount(event('settlement_recorded', { amount: 30, currency: 'EUR' })),
    ).toEqual({ after: '€30.00' });
    expect(
      formatActivityAmount(event('expense_deleted', { amount: 1500, currency: 'JPY' })),
    ).toEqual({ after: '¥1,500' });
    // Without an amount, there is none to show.
    expect(formatActivityAmount(event('expense_deleted', { description: 'Taxi' }), 'INR')).toBe(
      null,
    );
  });

  it('gives an edit that changed the amount the amount before and after, in the Expense’s currency', () => {
    const edit = event('expense_updated', {
      description: 'Wi-Fi',
      changes: {
        amount: { old: 899, new: 999 },
        amountMinor: { old: 89900, new: 99900 },
        paidBy: { old: [], new: [] },
      },
    });
    expect(formatActivityAmount(edit, 'INR')).toEqual({ before: '₹899.00', after: '₹999.00' });
    // An edit doesn't record the currency it left alone, so without one it claims nothing.
    expect(formatActivityAmount(edit)).toBeNull();
  });

  it('reads exact minor units, and falls back to the recorded major amount', () => {
    const minorOnly = event('expense_updated', {
      changes: { amountMinor: { old: 30, new: 1000030 } },
    });
    expect(formatActivityAmount(minorOnly, 'INR')).toEqual({
      before: '₹0.30',
      after: '₹10,000.30',
    });
    const legacy = event('expense_updated', { changes: { amount: { old: 0.1 + 0.2, new: 12 } } });
    expect(formatActivityAmount(legacy, 'INR')).toEqual({ before: '₹0.30', after: '₹12.00' });
  });

  it('keeps each side of a currency change in its own currency, never converted', () => {
    const edit = event('expense_updated', {
      changes: {
        amount: { old: 10, new: 900 },
        amountMinor: { old: 1000, new: 90000 },
        currency: { old: 'EUR', new: 'INR' },
      },
    });
    expect(formatActivityAmount(edit, 'USD')).toEqual({ before: '€10.00', after: '₹900.00' });
  });

  it('has no amount for an edit that left it alone, or for any other event', () => {
    const renamed = event('expense_updated', {
      description: 'Wi-Fi',
      changes: { description: { old: 'Internet', new: 'Wi-Fi' } },
    });
    expect(formatActivityAmount(renamed, 'INR')).toBeNull();
    expect(formatActivityAmount(event('expense_updated', { action: 'restored' }), 'INR')).toBe(
      null,
    );
    expect(formatActivityAmount(event('member_joined', { amount: 5 }), 'INR')).toBeNull();
    expect(
      formatActivityAmount(
        event('expense_updated', { changes: { amount: { old: 'a lot', new: 999 } } }),
        'INR',
      ),
    ).toBeNull();
  });
});
