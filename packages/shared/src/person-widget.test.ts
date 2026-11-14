import { expect, it } from 'vitest';
import { widgetPeople } from './widget-people';
import { personWidget, type PersonWidgetSetup } from './person-widget';
import type { WidgetCopy, WidgetSession } from './balances-widget';
import { groupWidget, type WidgetGroupPart } from './group-widget';
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
it('uses an extra launcher row for another full payment at 200% text', () => {
  expect(view(copy, { width: 360, height: 224 }, 2).payments).toHaveLength(1);
  const taller = view(copy, { width: 360, height: 344 }, 2);
  expect(taller.payments.map((payment) => payment.amount)).toEqual(['₹420.00', '€40.00']);
  expect(taller.more).toBeNull();
  expect(taller.layout.fits).toBe(true);
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

it('uses anonymous copy when a purged Person choice has no saved name', () => {
  const unnamed = { ...setup, person: { id: person.id } };
  const result = personWidget(null, unnamed, { width: 360, height: 224 }, auth, now);
  expect(result).toMatchObject({
    name: null,
    initials: null,
    description: 'This phone has no saved copy of your shared Groups. Open Splitbook to load them.',
  });
  expect(result.summary).not.toMatch(/undefined|Sam/);
});

it('takes the chosen name and initials from the copy when setup keeps only the id', () => {
  const result = personWidget(
    copy,
    { ...setup, person: { id: person.id } },
    { width: 360, height: 224 },
    auth,
    now,
  );
  expect(result).toMatchObject({ name: 'Sam', initials: 'SC' });
  expect(result.payments[0].label).toBe('You pay Sam');
});

it('ignores people, lines and all-square rows omitted by a same-age or newer verified list', () => {
  const dropped: WidgetCopy = { ...copy, savedGroups: { verifiedAt: now, rows: [] } };
  expect(widgetPeople(dropped, 'alex')).toEqual([]);
  expect(view(dropped).state).toBe('no-shared-group');
  expect(view(dropped).payments).toEqual([]);
  expect(view(dropped, { width: 360, height: 344 }).squareGroups).toEqual([]);
});

it('keeps only the remaining Group for a person shared through a dropped and a listed Group', () => {
  const dropped: WidgetCopy = {
    ...copy,
    groups: { maple: { ...maple, currencies: [] }, lisbon },
    savedGroups: {
      verifiedAt: now + 1,
      rows: [
        {
          id: 'lisbon',
          name: 'Lisbon & Tokyo',
          theme: 'trip',
          archived: false,
          members: 2,
          currencies: 1,
        },
      ],
    },
  };
  const result = view(dropped, { width: 360, height: 344 });
  expect(widgetPeople(dropped, 'alex').map((p) => p.groups.map((g) => g.id))).toEqual([['lisbon']]);
  expect(result.payments.map((p) => [p.groupId, p.amount])).toEqual([['lisbon', '€40.00']]);
  expect(result.squareGroups).toEqual([]);
});

it.each([
  [-1, 2],
  [0, 0],
  [1, 0],
])(
  'a list verified %s ms relative to the Person parts retains %s shared Groups',
  (offset, count) => {
    expect(
      widgetPeople({ ...copy, savedGroups: { verifiedAt: now + offset, rows: [] } }, 'alex')[0]
        ?.groups.length ?? 0,
    ).toBe(count);
  },
);

it('keeps a Group read newer than an omitted list, including a newer Balances part', () => {
  const newer: WidgetCopy = {
    ...copy,
    groups: { maple: { ...maple, balancesVerifiedAt: now + 1 }, lisbon },
    savedGroups: { verifiedAt: now, rows: [] },
  };
  expect(view(newer).payments.map((p) => p.groupId)).toEqual(['maple']);
});

it('is all square only when every shared Group has a saved Balances part with nothing suggested with this person', () => {
  const clear = {
    ...copy,
    groups: Object.fromEntries(
      Object.entries(copy.groups!).map(([id, g]) => [
        id,
        { ...g, currencies: g.currencies.map((bucket) => ({ ...bucket, payments: [] })) },
      ]),
    ),
  };
  const square = view(clear);
  expect(square.state).toBe('all-square');
  expect(square.title).toBe('All square with Sam');
  expect(square.payments).toEqual([]);
  expect(square.summary).toContain('Nothing is suggested either way');
  expect(view({ ...clear, groups: { maple: clear.groups.maple } }).state).toBe('no-copy');
});
it('removes stale lines when no Group is shared and offers this widget’s setup', () => {
  const gone = view({ ...copy, groupPeople: {}, savedGroups: { verifiedAt: now, rows: [] } });
  expect(gone.state).toBe('no-shared-group');
  expect(gone.title).toBe('No shared Group with Sam');
  expect(gone.payments).toEqual([]);
  expect(gone.rows).toEqual([]);
  expect(gone.action).toBe('Choose another');
  expect(gone.target).toEqual({ kind: 'setup', widgetId: 88 });
});
it('hides the person, initials, currencies and amounts, counting distinct Groups each way even with two currencies', () => {
  const data = {
    ...copy,
    groups: {
      ...copy.groups,
      maple: {
        ...maple,
        currencies: [
          ...maple.currencies,
          ...group('maple', 'Maple House', 'JPY', false, 42000).currencies,
        ],
      },
    },
  };
  const hidden = personWidget(
    data,
    { ...setup, hideAmounts: true },
    { width: 360, height: 224 },
    auth,
    now,
  );
  expect(hidden.name).toBe('One person');
  expect(hidden.initials).toBeNull();
  expect(hidden.payments).toEqual([]);
  expect(hidden.hiddenCounts).toEqual(['You pay in 1\u00a0Group', 'Pays you in 1\u00a0Group']);
  expect(hidden.summary).toContain('Amounts and names hidden');
  expect(JSON.stringify(hidden)).not.toMatch(/Sam|SC|₹|€|¥|INR|EUR|JPY|Maple|Lisbon/);
});
it('omits refused and archived Groups, including when their old people and payment rows remain on disk', () => {
  const refused = view({ ...copy, lostGroupIds: ['maple'] });
  expect(refused.payments.map((row) => row.groupName)).toEqual(['Lisbon & Tokyo']);
  const archived = view({
    ...copy,
    groups: { ...copy.groups, maple: { ...maple, archived: true } },
  });
  expect(archived.payments.map((row) => row.groupName)).toEqual(['Lisbon & Tokyo']);
  expect(archived.groupsLabel).toBe('1\u00a0Group together');
});

it('keeps the age of a zero-payment Balances part instead of presenting its absence of suggestions as fresh', () => {
  const clear = {
    ...copy,
    groups: Object.fromEntries(
      Object.entries(copy.groups!).map(([id, g]) => [
        id,
        {
          ...g,
          balancesVerifiedAt: now - 2 * 86400000,
          currencies: g.currencies.map((bucket) => ({ ...bucket, payments: [] })),
        },
      ]),
    ),
  };
  expect(view(clear)).toMatchObject({ state: 'all-square', muted: true, update: 'Open to update' });
});

it('fits every standing state and hidden counts across real sizes and text scales, with messages kept in one fixed block', () => {
  const square = {
    ...copy,
    groups: Object.fromEntries(
      Object.entries(copy.groups!).map(([id, g]) => [id, { ...g, currencies: [] }]),
    ),
  };
  const none = { ...copy, groupPeople: {}, savedGroups: { verifiedAt: now, rows: [] } };
  for (const width of [172, 220, 266, 360, 440, 640])
    for (const height of [224, 284, 344, 464, 584, 640])
      for (const scale of [1, 1.3, 2])
        for (const [data, hidden] of [
          [copy, true],
          [square, false],
          [square, true],
          [none, false],
          [none, true],
          [null, false],
          [null, true],
        ] as const) {
          const result = personWidget(
              data,
              { ...setup, hideAmounts: hidden },
              { width, height, pixelRatio: 2.625 },
              auth,
              now,
              scale,
            ),
            l = result.layout;
          expect(l.fits, `${result.state} ${width}×${height} at ${scale}, hidden ${hidden}`).toBe(
            true,
          );
          expect(
            l.sections.reduce((n, s) => n + s.height, 0) +
              Math.max(0, l.sections.length - 1) * l.gap +
              2 * l.padding,
          ).toBeLessThanOrEqual(height + 0.001);
          if (hidden) {
            expect(result.summary).not.toMatch(/Sam|SC|₹|€|Maple|Lisbon/);
            expect(result.payments).toEqual([]);
          }
          if (result.more?.startsWith('+')) expect(result.rows.length).toBeGreaterThan(0);
          if (result.layout.sections.some((s) => s.id === 'message'))
            expect(l.sections.find((s) => s.id === 'space')?.height).toBeGreaterThanOrEqual(0);
        }
});

it('agrees with the Group widget on the exact Suggested payment', () => {
  const source = groupWidget(
    maple,
    { kind: 'group', widgetId: 7, accountId: 'alex', groupId: 'maple' },
    { width: 360, height: 224 },
    auth,
    now,
  );
  const filtered = view().payments.filter((row) => row.groupId === 'maple');
  expect(filtered.map((row) => [row.label, row.amount, row.amountMinor, row.currency])).toEqual(
    source.payments.map((row) => [row.label, row.amount, 42000, row.currency]),
  );
});

it('shows the no-shared choice without a name after its setup labels were purged', () => {
  const result = personWidget(
    { ...copy, groupPeople: {}, savedGroups: { verifiedAt: now, rows: [] } },
    { ...setup, person: { id: person.id } },
    { width: 360, height: 224 },
    auth,
    now,
  );
  expect(result).toMatchObject({
    state: 'no-shared-group',
    title: 'No shared Group',
    name: null,
    initials: null,
    payments: [],
    action: 'Choose another',
  });
  expect(result.summary).not.toMatch(/null|undefined|Sam/);
});

it('ages Person figures by the older Group read even when membership and Balances are fresh', () => {
  const olderGroup: WidgetCopy = {
    ...copy,
    groups: {
      ...copy.groups,
      maple: { ...maple, verifiedAt: now - 25 * 3600000 },
    },
  };
  expect(view(olderGroup)).toMatchObject({ muted: true, update: 'Open to update' });
});

it('admits the next all-square line at 4x3 and 130 percent before stretching the two payments', () => {
  const c: WidgetCopy = {
    ...copy,
    groups: {
      ...copy.groups,
      football: { ...maple, id: 'football', name: 'Sunday Football', currencies: [] },
    },
    groupPeople: {
      ...copy.groupPeople,
      football: { name: 'Sunday Football', archived: false, verifiedAt: now, people: [person] },
    },
  };
  const result = view(c, { width: 360, height: 344 }, 1.3);
  expect(result.rows.map((r) => r.kind)).toEqual(['payment', 'payment', 'square']);
  expect(result.rows[2].groupName).toBe('Sunday Football');
  expect(result.more).toBeNull();
  expect(result.layout.fits).toBe(true);
});
