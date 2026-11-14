import { overviewAt } from '../test-utils/overview-widget';
import { widgetDimensions } from '../test-utils/widget-size';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type WidgetCopy } from '@splitbook/shared/balances-widget';
import { groupWidget, type WidgetGroupPart } from '@splitbook/shared/group-widget';
import { quickWidget } from '@splitbook/shared/quick-widget';
const now = Date.parse('2026-11-08T04:11:00Z');
const previous = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Kolkata';
});
afterAll(() => {
  process.env.TZ = previous;
});
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup = { kind: 'group' as const, widgetId: 7, accountId: 'alex', groupId: 'maple' };
const part: WidgetGroupPart = {
  id: 'maple',
  name: 'Maple House',
  theme: 'home',
  archived: false,
  mainCurrency: 'INR',
  verifiedAt: now,
  balancesVerifiedAt: now,
  currencies: [
    {
      currency: 'INR',
      balanceMinor: -148000,
      payments: [
        {
          from: 'alex',
          to: 'priya',
          fromName: 'Alex Rivera',
          toName: 'Priya Shah',
          amountMinor: 148000,
        },
      ],
    },
  ],
};
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: {
    verifiedAt: now,
    groupCount: 4,
    currencies: [
      { currency: 'INR', owedMinor: 240000, oweMinor: 148000 },
      { currency: 'EUR', owedMinor: 4000, oweMinor: 0 },
    ],
  },
  groups: { maple: part },
  review: { count: 3, verifiedAt: now },
};
it('summarizes Balances with complete amounts and their verification time', () => {
  expect(overviewAt(copy, { kind: 'balances' }, '2x2', auth, now).summary).toBe(
    'Balances. You’re owed ₹2,400.00 and €40.00. You owe ₹1,480.00. You pay Priya ₹1,480.00 in Maple House. To review 3. Saved 9:41.',
  );
});
it('summarizes a Group with first names only', () => {
  expect(groupWidget(part, setup, widgetDimensions('4x2'), auth, now).summary).toBe(
    'Group. Maple House. You owe ₹1,480.00. You pay Priya ₹1,480.00. This Month. Open the Group to update. Saved 9:41.',
  );
});
it('speaks the visible Group name but not amounts or member names when hidden', () => {
  const b = overviewAt(copy, { kind: 'balances', hideAmounts: true }, '2x2', auth, now).summary;
  const g = groupWidget(
    part,
    { ...setup, hideAmounts: true },
    widgetDimensions('4x2'),
    auth,
    now,
  ).summary;
  expect(b).toContain('Amounts hidden');
  expect(g).toContain('You owe 1\u00a0person');
  expect(g).toContain('Amounts and names hidden');
  expect(g).toContain('Maple House');
  expect(b + g).not.toMatch(/₹|€|1,480|2,400|40\.00|Priya|Shah|Alex/);
});
it.each(['signed-out', 'expired'] as const)(
  'speaks the %s explanation without saved private data',
  (status) => {
    const b = overviewAt(copy, { kind: 'balances' }, '2x2', { status }, now).summary;
    const g = groupWidget(part, setup, widgetDimensions('4x2'), { status }, now).summary;
    expect(b + g).toContain(status === 'expired' ? 'Sign in again' : 'Sign in');
    expect(b + g).not.toMatch(/₹|€|Maple|Priya|Saved/);
  },
);
it('names the Group in the icon-only Add expense summary', () => {
  expect(
    quickWidget(copy, { ...setup, kind: 'quick' }, { width: 78, height: 104 }, auth).summary,
  ).toBe('Add expense in Maple House');
});

it.each(['2x1', '2x2', '4x2'] as const)(
  'announces loading, no saved copy, all square, no Groups and stale Balances at %s',
  (size) => {
    expect(
      overviewAt(null, { kind: 'balances' }, size, { ...auth, loading: true }, now).summary,
    ).toContain('Loading');
    expect(overviewAt(null, { kind: 'balances' }, size, auth, now).summary).toContain(
      'Nothing saved yet',
    );
    expect(
      overviewAt(
        { ...copy, home: { ...copy.home!, currencies: [] } },
        { kind: 'balances' },
        size,
        auth,
        now,
      ).summary,
    ).toContain('all square');
    expect(
      overviewAt(
        { ...copy, home: { ...copy.home!, groupCount: 0, currencies: [] } },
        { kind: 'balances' },
        size,
        auth,
        now,
      ).summary,
    ).toContain('No Groups yet');
    expect(overviewAt(copy, { kind: 'balances' }, size, auth, now + 86400001).summary).toContain(
      'Open to update',
    );
  },
);
it.each(['2x2', '4x2', '4x3'] as const)(
  'announces every saved Group state without names after lost access or account change at %s',
  (size) => {
    expect(
      groupWidget(undefined, setup, widgetDimensions(size), { ...auth, loading: true }, now)
        .summary,
    ).toContain('Loading');
    expect(groupWidget(undefined, setup, widgetDimensions(size), auth, now).summary).toContain(
      'Nothing saved yet',
    );
    expect(
      groupWidget({ ...part, currencies: [] }, setup, widgetDimensions(size), auth, now).summary,
    ).toContain('all square');
    expect(
      groupWidget({ ...part, archived: true }, setup, widgetDimensions(size), auth, now).summary,
    ).toContain('final');
    expect(
      groupWidget(part, setup, widgetDimensions(size), auth, now + 86400001).summary,
    ).toContain('Open to update');
    const lost = groupWidget(null, setup, widgetDimensions(size), auth, now).summary;
    expect(lost).toContain('no longer in this Group');
    expect(lost).not.toMatch(/Maple|Priya|₹/);
    const other = groupWidget(
      part,
      setup,
      widgetDimensions(size),
      { ...auth, accountId: 'sam' },
      now,
    ).summary;
    expect(other).toContain('Set up this widget again');
    expect(other).not.toMatch(/Maple|Priya|₹/);
  },
);
it.each(['1x1', '2x1'] as const)(
  'announces each Add expense state at %s, without disclosing the saved Group when unavailable',
  (size) => {
    const quick = { ...setup, kind: 'quick' as const };
    for (const status of ['signed-out', 'expired'] as const) {
      const v = quickWidget(
        copy,
        quick,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        { status },
      );
      expect(v.summary).toContain('Sign in');
      expect(v.summary).not.toContain('Maple');
    }
    expect(
      quickWidget(
        copy,
        { ...quick, groupId: null },
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        auth,
      ).summary,
    ).toContain('Choose a Group');
    expect(
      quickWidget(
        copy,
        quick,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        { ...auth, accountId: 'sam' },
      ).summary,
    ).toBe('Set up again. Another account');
    expect(
      quickWidget(
        { ...copy, lostGroupIds: ['maple'] },
        quick,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        auth,
      ).summary,
    ).toBe('Add expense. Not in this Group. Choose a Group');
    expect(
      quickWidget(
        { ...copy, groups: { maple: { ...part, archived: true } } },
        quick,
        size === '1x1' ? { width: 78, height: 104 } : { width: 172, height: 104 },
        auth,
      ).summary,
    ).toBe('Add expense in Maple House. Group archived. Choose another');
  },
);

it('speaks the compact Group’s Main currency amount and wide payment overflow', () => {
  const multi = {
    ...part,
    currencies: [
      ...part.currencies,
      {
        currency: 'EUR',
        balanceMinor: 4000,
        payments: [
          {
            from: 'sam',
            to: 'alex',
            fromName: 'Sam Chen',
            toName: 'Alex Rivera',
            amountMinor: 4000,
          },
        ],
      },
      {
        currency: 'JPY',
        balanceMinor: 3000,
        payments: [
          {
            from: 'sam',
            to: 'alex',
            fromName: 'Sam Chen',
            toName: 'Alex Rivera',
            amountMinor: 3000,
          },
        ],
      },
    ],
  };
  expect(groupWidget(multi, setup, widgetDimensions('2x2'), auth, now).summary).toContain(
    'You owe ₹1,480.00',
  );
  expect(groupWidget(multi, setup, widgetDimensions('2x2'), auth, now).summary).toContain(
    'In 3\u00a0currencies',
  );
  expect(groupWidget(multi, setup, widgetDimensions('4x2'), auth, now).summary).toContain(
    'Sam pays you ¥3,000',
  );
});

it('names the extra currency when compact Balances omits it', () => {
  expect(overviewAt(copy, { kind: 'balances' }, '2x1', auth, now).summary).toContain(
    'You’re owed ₹2,400.00 and €40.00',
  );
});
const priyas = (
  first: [string, string | undefined],
  second: [string, string | undefined],
): WidgetGroupPart => ({
  ...part,
  currencies: [
    {
      currency: 'INR',
      balanceMinor: -148000,
      payments: [
        {
          from: 'alex',
          to: 'priya-1',
          fromName: 'Alex',
          toName: first[0],
          toInitials: first[1],
          amountMinor: 106000,
        },
        {
          from: 'priya-2',
          to: 'alex',
          fromName: second[0],
          fromInitials: second[1],
          toName: 'Alex',
          amountMinor: 42000,
        },
        {
          from: 'alex',
          to: 'sam',
          fromName: 'Alex',
          toName: 'Sam',
          toInitials: 'SL',
          amountMinor: 1000,
        },
      ],
    },
  ],
});
it('speaks the second initial only for rows that share a first name', () => {
  const summary = groupWidget(
    priyas(['Priya', 'PS'], ['Priya', 'PK']),
    setup,
    widgetDimensions('4x3'),
    auth,
    now,
  ).summary;
  expect(summary).toContain('You pay Priya S ₹1,060.00');
  expect(summary).toContain('Priya K pays you ₹420.00');
  expect(summary).toContain('You pay Sam ₹10.00');
});
it.each([
  ['old copies without initials', ['Priya', undefined], ['Priya', undefined]],
  ['matching initials', ['Priya', 'PS'], ['Priya', 'PS']],
] as const)('keeps first names only for %s', (_, first, second) => {
  const summary = groupWidget(
    priyas([...first], [...second]),
    setup,
    widgetDimensions('4x3'),
    auth,
    now,
  ).summary;
  expect(summary).toContain('You pay Priya ₹1,060.00');
  expect(summary).toContain('Priya pays you ₹420.00');
});
it('speaks no names or initials for duplicate first names when hidden', () => {
  const summary = groupWidget(
    priyas(['Priya', 'PS'], ['Priya', 'PK']),
    { ...setup, hideAmounts: true },
    widgetDimensions('4x3'),
    auth,
    now,
  ).summary;
  expect(summary).not.toMatch(/Priya|Sam|₹/);
});
