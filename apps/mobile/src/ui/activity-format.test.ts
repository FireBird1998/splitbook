import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../data/activity';
import { activityDays, dayLabel, describeActivity, describeChanges } from './activity-format';

const now = new Date(2026, 8, 30, 12).getTime();
const at = (day: number, hour = 10) => new Date(2026, 8, day, hour).toISOString();
const event = (overrides: Partial<ActivityEvent>): ActivityEvent => ({
  _id: 'd00000000000000000000001',
  group: 'b00000000000000000000001',
  type: 'expense_added',
  actor: { _id: 'a00000000000000000000001', name: 'Priya Shah' },
  createdAt: at(30),
  metadata: {},
  ...overrides,
});

describe('Activity days', () => {
  it('labels today and yesterday, and dates older days', () => {
    expect(dayLabel(new Date(at(30, 1)), now)).toBe('Today');
    expect(dayLabel(new Date(at(29, 23)), now)).toBe('Yesterday');
    const older = dayLabel(new Date(at(27)), now);
    expect(older).not.toMatch(/Today|Yesterday/);
    expect(older).toContain('27');
  });

  it('keeps newest-first order and starts a new group at each local day', () => {
    const events = [
      event({ _id: '1', createdAt: at(30, 9) }),
      event({ _id: '2', createdAt: at(30, 8) }),
      event({ _id: '3', createdAt: at(29, 20) }),
      event({ _id: '4', createdAt: at(27) }),
    ];
    expect(
      activityDays(events, now).map((day) => [day.label, day.events.map((e) => e._id)]),
    ).toEqual([
      ['Today', ['1', '2']],
      ['Yesterday', ['3']],
      [dayLabel(new Date(at(27)), now), ['4']],
    ]);
  });
});

describe('Expense edits in plain language', () => {
  const members = [
    { id: 'a00000000000000000000001', name: 'Priya Shah' },
    { id: 'a00000000000000000000002', name: 'Sam Chen' },
  ];

  it('reads like the Expense history: amounts, names and shares, never references', () => {
    const lines = describeChanges(
      {
        amount: { old: 899, new: 999 },
        amountMinor: { old: 89900, new: 99900 },
        description: { old: 'Wifi', new: 'Wi-Fi' },
        paidBy: {
          old: [{ user: 'a00000000000000000000001', amount: 899, amountMinor: 89900 }],
          new: [{ user: 'a00000000000000000000001', amount: 999, amountMinor: 99900 }],
        },
        splitBetween: {
          old: [{ user: 'a00000000000000000000002', amount: 899, amountMinor: 89900 }],
          new: [{ user: 'a00000000000000000000009', amount: 999, amountMinor: 99900 }],
        },
        tagId: { old: 'c00000000000000000000001', new: 'c00000000000000000000002' },
        tag: { old: 'Utilities', new: 'Internet' },
      },
      { currency: 'INR', members },
    );
    expect(lines).toEqual([
      'Amount ₹899.00 → ₹999.00',
      'Description “Wifi” → “Wi-Fi”',
      'Priya Shah’s payment ₹899.00 → ₹999.00',
      'Former member’s share Not included → ₹999.00',
      'Sam Chen’s share ₹899.00 → Not included',
      'Tag Utilities → Internet',
    ]);
    expect(lines.join(' ')).not.toMatch(/[0-9a-f]{24}/);
  });

  it('keeps each amount in the currency it had when the edit changes currency', () => {
    expect(
      describeChanges(
        { amount: { old: 10, new: 12 }, currency: { old: 'INR', new: 'USD' } },
        { currency: 'INR' },
      ),
    ).toEqual(['Amount ₹10.00 → $12.00', 'Currency INR → USD']);
  });

  it('names a change it can only report, such as an unknown field', () => {
    expect(describeChanges({ receipt: { old: null, new: 'x' } }, { currency: 'INR' })).toEqual([
      'Other details changed',
    ]);
  });
});

describe('Activity headlines', () => {
  const context = { currentUserId: 'a00000000000000000000009', currency: 'INR' };

  it('names the signed-in member "You" and shows the amount', () => {
    const line = describeActivity(
      event({
        actor: { _id: context.currentUserId, name: 'Alex Rao' },
        metadata: { description: 'Weekly groceries', amount: 1249.5, currency: 'INR' },
      }),
      context,
    );
    expect(line).toMatchObject({
      actor: 'You',
      verb: 'added',
      subject: 'Weekly groceries',
      details: [{ text: '₹1,249.50', mono: true }],
    });
  });

  it('summarises an edit by its first change and how many more', () => {
    const line = describeActivity(
      event({
        type: 'expense_updated',
        metadata: {
          description: 'Wi-Fi',
          changes: { amount: { old: 899, new: 999 }, notes: { old: '', new: 'x' } },
        },
      }),
      context,
    );
    expect(line.verb).toBe('edited');
    expect(line.details.map((detail) => detail.text)).toEqual([
      'Amount ₹899.00 → ₹999.00',
      '1 more',
    ]);
    expect(line.changes).toHaveLength(2);
  });

  it('shows who paid whom for a payment, and a fallback for a former member', () => {
    const line = describeActivity(
      event({
        type: 'settlement_recorded',
        actor: null,
        metadata: {
          amount: 200,
          currency: 'INR',
          paidByName: 'Priya Shah',
          paidToName: 'Sam Chen',
        },
      }),
      context,
    );
    expect(line).toMatchObject({
      actor: 'Former member',
      verb: 'recorded a payment',
      subject: null,
    });
    expect(line.details.map((detail) => detail.text)).toEqual(['Priya Shah → Sam Chen', '₹200.00']);
  });
});
