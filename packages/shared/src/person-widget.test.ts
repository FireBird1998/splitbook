import { expect, it } from 'vitest';
import { widgetPeople } from './widget-people';
import { personWidget, type PersonWidgetSetup } from './person-widget';
import type { WidgetCopy, WidgetSession } from './balances-widget';
import type { WidgetGroupPart } from './group-widget';
const now = Date.parse('2026-11-13T04:11:00Z');
const person = { id: 'sam', firstName: 'Sam', initials: 'SC' };
const setup: PersonWidgetSetup = { kind: 'person', widgetId: 88, accountId: 'alex', person };
const auth: WidgetSession = { status: 'authenticated', accountId: 'alex', loading: false };
const group = (
  id: string,
  name: string,
  currency: string,
  incoming: boolean,
  amountMinor: number,
): WidgetGroupPart => ({
  id,
  name,
  theme: 'home',
  archived: false,
  mainCurrency: currency,
  verifiedAt: now,
  balancesVerifiedAt: now,
  currencies: [
    {
      currency,
      balanceMinor: incoming ? amountMinor : -amountMinor,
      payments: [
        {
          from: incoming ? 'sam' : 'alex',
          to: incoming ? 'alex' : 'sam',
          fromName: incoming ? 'Sam' : 'Alex',
          toName: incoming ? 'Alex' : 'Sam',
          fromInitials: incoming ? 'SC' : 'AR',
          toInitials: incoming ? 'AR' : 'SC',
          amountMinor,
        },
      ],
    },
  ],
});
const maple = group('maple', 'Maple House', 'INR', false, 42000);
const lisbon = group('lisbon', 'Lisbon & Tokyo', 'EUR', true, 4000);
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: null,
  groups: { maple, lisbon },
  groupPeople: {
    maple: { name: 'Maple House', archived: false, verifiedAt: now, people: [person] },
    lisbon: { name: 'Lisbon & Tokyo', archived: false, verifiedAt: now, people: [person] },
  },
};
const view = (
  data: WidgetCopy | null = copy,
  size = { width: 360, height: 224 },
  scale = 1,
  session: WidgetSession = auth,
) => personWidget(data, setup, size, session, now, scale);
it('shows each Group and currency separately, from the same Suggested payments, with an unsaved Settle up target', () => {
  const result = view();
  expect(result.name).toBe('Sam');
  expect(result.groupsLabel).toBe('2\u00a0Groups together');
  expect(result.payments.map((p) => [p.label, p.amount, p.groupName])).toEqual([
    ['You pay Sam', '₹420.00', 'Maple House'],
    ['Sam pays you', '€40.00', 'Lisbon & Tokyo'],
  ]);
  expect(result.payments[0].target).toEqual({
    kind: 'settle',
    groupId: 'maple',
    payment: { from: 'alex', to: 'sam', currency: 'INR' },
  });
  expect(result.summary).toContain('You pay Sam ₹420.00 in Maple House');
  expect(result.summary).toContain('Sam pays you €40.00 in Lisbon & Tokyo');
  expect(result).not.toHaveProperty('total');
});

it('fills real launcher sizes with fitting rows, a grey count when none fit, and +more only after a row', () => {
  const many: WidgetCopy = {
    ...copy,
    groups: { ...copy.groups },
    groupPeople: { ...copy.groupPeople },
  };
  for (let i = 0; i < 9; i++) {
    many.groups!['g' + i] = group(
      'g' + i,
      'A very long shared Group name ' + i,
      'JPY',
      false,
      42000,
    );
    many.groupPeople!['g' + i] = {
      name: 'A very long shared Group name ' + i,
      archived: false,
      verifiedAt: now,
      people: [person],
    };
  }
  for (const width of [172, 220, 266, 360, 440, 640])
    for (const height of [224, 284, 344, 464, 584, 640])
      for (const scale of [1, 1.3, 2]) {
        const result = view(many, { width, height }, scale),
          l = result.layout;
        expect(l.fits, `${width}×${height} at ${scale}`).toBe(true);
        expect(
          l.sections.reduce((n, s) => n + s.height, 0) +
            Math.max(0, l.sections.length - 1) * l.gap +
            2 * l.padding,
        ).toBeLessThanOrEqual(height + 0.001);
        expect(l.sections.some((s) => s.id === 'header')).toBe(true);
        expect(result.payments.every((p) => p.height >= p.minimumHeight)).toBe(true);
        if (result.more?.startsWith('+')) expect(result.payments.length).toBeGreaterThan(0);
        expect(l.fonts.name).toBeGreaterThanOrEqual(10);
      }
  const huge = group('huge', 'Huge Group', 'INR', false, 999999999999);
  const tooWide = {
    ...copy,
    groups: { huge },
    groupPeople: { huge: { name: huge.name, archived: false, verifiedAt: now, people: [person] } },
  };
  const small = view(tooWide, { width: 172, height: 224 }, 2);
  expect(small.payments).toEqual([]);
  expect(small.more).toBe('1\u00a0payment');
});

it.each([
  ['signed-out', { status: 'signed-out' }],
  ['expired', { status: 'expired' }],
  ['other-account', { status: 'authenticated', accountId: 'someone-else', loading: false }],
] as const)(
  'hides the person and every line in %s while keeping its action fitted',
  (state, session) => {
    for (const scale of [1, 1.3, 2]) {
      const result = view(copy, { width: 172, height: 224 }, scale, session);
      expect(result.state).toBe(state);
      expect(result.name).toBeNull();
      expect(result.initials).toBeNull();
      expect(result.payments).toEqual([]);
      expect(result.summary).not.toMatch(/Sam|SC|420|Maple|Lisbon/);
      expect(result.layout.fits).toBe(true);
      expect(result.layout.sections.at(-1)?.id).toBe('action');
    }
  },
);
it('keeps the chosen name without inventing payments when a copy is missing or loading', () => {
  const none = view(null);
  expect(none.state).toBe('no-copy');
  expect(none.name).toBe('Sam');
  expect(none.description).toContain('no saved copy');
  const loading = view(null, { width: 172, height: 224 }, 1, { ...auth, loading: true });
  expect(loading.state).toBe('loading');
  expect(loading.payments).toEqual([]);
  expect(loading.layout.sections.some((s) => s.id === 'loading')).toBe(true);
});
it('drops the optional Group count in compact headers before it wraps over the payment rows', () => {
  for (const scale of [1, 1.3, 2]) {
    const small = view(copy, { width: 172, height: 224 }, scale);
    expect(small.layout.showGroups).toBe(false);
    expect(small.layout.subtitleLines).toEqual([]);
    expect(small.summary).toContain('2\u00a0Groups together');
    expect(small.name).toBe('Sam');
  }
  expect(view().layout.showGroups).toBe(true);
  const missing = view(null, { width: 172, height: 224 }, 1.3);
  expect(missing.layout.showGroups).toBe(true);
  expect(missing.layout.subtitleLines.join(' ')).toBe('Nothing saved yet');
});
it('gives two people called Sam their second initial, also in the complete TalkBack lines', () => {
  const second = { id: 'other-sam', firstName: 'Sam', initials: 'ST' };
  const result = view({
    ...copy,
    groupPeople: {
      ...copy.groupPeople,
      maple: { ...copy.groupPeople!.maple, people: [person, second] },
    },
  });
  expect(result.name).toBe('Sam C');
  expect(result.initials).toBe('SC');
  expect(result.summary).toContain('You pay Sam C ₹420.00 in Maple House');
});

it('keeps two currencies in one Group as two exact lines, including whole yen, and never nets them', () => {
  const multi = {
    ...maple,
    currencies: [
      ...maple.currencies,
      ...group('maple', 'Maple House', 'JPY', true, 42000).currencies,
    ],
  };
  const result = view(
    { ...copy, groups: { maple: multi }, groupPeople: { maple: copy.groupPeople!.maple } },
    { width: 360, height: 344 },
  );
  expect(result.groupsLabel).toBe('1\u00a0Group together');
  expect(result.payments.map((row) => [row.currency, row.amountMinor, row.amount])).toEqual([
    ['INR', 42000, '₹420.00'],
    ['JPY', 42000, '¥42,000'],
  ]);
});
it('uses taller space for shared all-square Groups after payments, while TalkBack keeps every line at smaller sizes', () => {
  const football = { ...group('football', 'Sunday Football', 'INR', false, 0), currencies: [] };
  const data = {
    ...copy,
    groups: { ...copy.groups, football },
    groupPeople: {
      ...copy.groupPeople,
      football: { name: 'Sunday Football', archived: false, verifiedAt: now, people: [person] },
    },
  };
  const tall = view(data, { width: 360, height: 344 });
  expect(tall.rows.map((row) => row.groupName)).toEqual([
    'Maple House',
    'Lisbon & Tokyo',
    'Sunday Football',
  ]);
  expect(tall.rows[2]).toMatchObject({ kind: 'square', label: 'All square' });
  const large = view(data, { width: 360, height: 224 }, 2);
  expect(large.payments).toHaveLength(1);
  expect(large.more).toBe('+1 more');
  expect(large.summary).toContain('Sam pays you €40.00 in Lisbon & Tokyo');
  expect(large.summary).toContain('All square in Sunday Football');
  expect(large.layout.showSaved).toBe(false);
  expect(large.layout.fonts.label).toBe(12);
});
it('treats an old or unreadable copy as absent while keeping setup and a readable explanation', () => {
  const old = view({ version: 1, accountId: 'alex', home: null });
  expect(old.state).toBe('no-copy');
  expect(old.name).toBe('Sam');
  const broken = view({
    ...copy,
    groupPeople: { maple: null } as unknown as WidgetCopy['groupPeople'],
  });
  expect(broken.state).toBe('no-copy');
  expect(broken.payments).toEqual([]);
});

it('keeps setup usable when a saved membership row is damaged', () => {
  const partial = {
    ...copy,
    groupPeople: { ...copy.groupPeople, broken: null } as unknown as WidgetCopy['groupPeople'],
  };
  expect(widgetPeople(partial, 'alex').map((person) => person.name)).toEqual(['Sam']);
  expect(widgetPeople(partial, 'other')).toEqual([]);
});
