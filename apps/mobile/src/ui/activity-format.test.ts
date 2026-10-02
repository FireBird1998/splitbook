import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../data/activity';
import {
  activityDays,
  dayLabel,
  describeActivity,
  describeChanges,
  spokenActivity,
  type ActivityLine,
} from './activity-format';

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

describe('Group edits in plain language', () => {
  const you = 'a00000000000000000000009';
  const priya = 'a00000000000000000000001';
  const context = {
    currentUserId: you,
    currency: 'INR',
    members: [
      { id: you, name: 'Alex Rao' },
      { id: priya, name: 'Priya Shah' },
    ],
  };
  const edit = (changes: Record<string, { old?: unknown; new?: unknown }>, actor = you) =>
    describeActivity(
      event({
        type: 'group_updated',
        actor: { _id: actor, name: context.members.find((member) => member.id === actor)?.name },
        metadata: { changes },
      }),
      context,
    );
  const read = (line: ActivityLine) => ({
    headline: spokenActivity(line, '11:05'),
    details: line.details.map((detail) => detail.text),
    changes: line.changes,
  });
  const role = (userId: string, old: string, now: string) => ({
    memberRole: { old: { userId, role: old }, new: { userId, role: now } },
  });

  it('says who was made an admin or a member, by name or as you', () => {
    expect(read(edit(role(priya, 'member', 'admin')))).toEqual({
      headline: 'You made Priya Shah an admin, Member role, 11:05',
      details: ['Member role'],
      changes: ['Priya Shah’s role Member → Group admin'],
    });
    expect(read(edit(role(you, 'admin', 'member'), priya))).toEqual({
      headline: 'Priya Shah made you a member, Member role, 11:05',
      details: ['Member role'],
      changes: ['Your role Group admin → Member'],
    });
    expect(read(edit(role(priya, 'admin', 'member'), priya)).headline).toBe(
      'Priya Shah made themselves a member, Member role, 11:05',
    );
  });

  it('calls someone the Group no longer has a former member, never a reference', () => {
    const line = edit(role('a00000000000000000000004', 'member', 'admin'));
    expect(read(line)).toEqual({
      headline: 'You made a former member an admin, Member role, 11:05',
      details: ['Member role'],
      changes: ['Former member’s role Member → Group admin'],
    });
    expect(JSON.stringify(line)).not.toMatch(/[0-9a-f]{24}/);
  });

  it('shows a rename, a currency change and archiving plainly', () => {
    expect(read(edit({ name: { old: 'Maple House', new: 'Maple Flat' } }))).toEqual({
      headline: 'You renamed the Group, “Maple House” → “Maple Flat”, 11:05',
      details: ['“Maple House” → “Maple Flat”'],
      changes: ['Name “Maple House” → “Maple Flat”'],
    });
    expect(read(edit({ defaultCurrency: { old: 'INR', new: 'USD' } }))).toEqual({
      headline: 'You changed the currency, INR → USD, 11:05',
      details: ['INR → USD'],
      changes: ['Currency INR → USD'],
    });
    expect(read(edit({ isArchived: { old: false, new: true } }))).toEqual({
      headline: 'You archived the Group, 11:05',
      details: [],
      changes: ['Status Active → Archived'],
    });
  });

  it('leads with the first change and lists every change for the detail', () => {
    const line = edit({
      name: { old: 'Maple House', new: 'Maple Flat' },
      description: { old: '', new: 'Flat 302' },
      category: { old: 'home', new: 'trip' },
      startDate: { old: null, new: '2026-10-01T00:00:00.000Z' },
    });
    expect(read(line)).toEqual({
      headline: 'You renamed the Group, “Maple House” → “Maple Flat”, 3 more, 11:05',
      details: ['“Maple House” → “Maple Flat”', '3 more'],
      changes: [
        'Name “Maple House” → “Maple Flat”',
        'Description None → “Flat 302”',
        'Theme Household → Trip',
        'Start date None → Oct 1, 2026',
      ],
    });
  });

  it('keeps today’s wording for a change it doesn’t know, after the ones it does', () => {
    expect(read(edit({ coverImage: { old: null, new: 'x' } }))).toEqual({
      headline: 'You updated the Group details, 11:05',
      details: [],
      changes: ['Other details changed'],
    });
    expect(
      read(edit({ coverImage: { old: null, new: 'x' }, name: { old: 'A', new: 'B' } })).changes,
    ).toEqual(['Name “A” → “B”', 'Other details changed']);
    expect(read(edit({}))).toEqual({
      headline: 'You updated the Group details, 11:05',
      details: [],
      changes: [],
    });
  });
});
