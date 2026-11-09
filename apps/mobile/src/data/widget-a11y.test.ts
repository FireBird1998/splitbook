import { afterAll, beforeAll, expect, it } from 'vitest';
import { balancesWidget, type WidgetCopy } from '@splitbook/shared/balances-widget';
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
  expect(balancesWidget(copy, { kind: 'balances' }, '2x2', auth, now).summary).toBe(
    'Balances. You’re owed ₹2,400.00 and €40.00. You owe ₹1,480.00. Saved 9:41. To review 3.',
  );
});
it('summarizes a Group with first names only', () => {
  expect(groupWidget(part, setup, '4x2', auth, now).summary).toBe(
    'Group. Maple House. You owe ₹1,480.00. You pay Priya ₹1,480.00. Saved 9:41.',
  );
});
it('speaks the visible Group name but not amounts or member names when hidden', () => {
  const b = balancesWidget(copy, { kind: 'balances', hideAmounts: true }, '2x2', auth, now).summary;
  const g = groupWidget(part, { ...setup, hideAmounts: true }, '4x2', auth, now).summary;
  expect(b).toContain('Amounts hidden');
  expect(g).toContain('You owe 1\u00a0person');
  expect(g).toContain('Amounts and names hidden');
  expect(g).toContain('Maple House');
  expect(b + g).not.toMatch(/₹|€|1,480|2,400|40\.00|Priya|Shah|Alex/);
});
it.each(['signed-out', 'expired'] as const)(
  'speaks the %s explanation without saved private data',
  (status) => {
    const b = balancesWidget(copy, { kind: 'balances' }, '2x2', { status }, now).summary;
    const g = groupWidget(part, setup, '4x2', { status }, now).summary;
    expect(b + g).toContain(status === 'expired' ? 'Sign in again' : 'Sign in');
    expect(b + g).not.toMatch(/₹|€|Maple|Priya|Saved/);
  },
);
it('names the Group in the icon-only Add expense summary', () => {
  expect(quickWidget(copy, { ...setup, kind: 'quick' }, '1x1', auth).summary).toBe(
    'Add expense in Maple House',
  );
});

it.each(['2x1', '2x2', '4x2'] as const)(
  'announces loading, no saved copy, all square, no Groups and stale Balances at %s',
  (size) => {
    expect(
      balancesWidget(null, { kind: 'balances' }, size, { ...auth, loading: true }, now).summary,
    ).toContain('Loading');
    expect(balancesWidget(null, { kind: 'balances' }, size, auth, now).summary).toContain(
      'Nothing saved yet',
    );
    expect(
      balancesWidget(
        { ...copy, home: { ...copy.home!, currencies: [] } },
        { kind: 'balances' },
        size,
        auth,
        now,
      ).summary,
    ).toContain('all square');
    expect(
      balancesWidget(
        { ...copy, home: { ...copy.home!, groupCount: 0, currencies: [] } },
        { kind: 'balances' },
        size,
        auth,
        now,
      ).summary,
    ).toContain('No Groups yet');
    expect(
      balancesWidget(copy, { kind: 'balances' }, size, auth, now + 86400001).summary,
    ).toContain('Open to update');
  },
);
it.each(['2x2', '4x2', '4x3'] as const)(
  'announces every saved Group state without names after lost access or account change at %s',
  (size) => {
    expect(groupWidget(undefined, setup, size, { ...auth, loading: true }, now).summary).toContain(
      'Loading',
    );
    expect(groupWidget(undefined, setup, size, auth, now).summary).toContain('Nothing saved yet');
    expect(groupWidget({ ...part, currencies: [] }, setup, size, auth, now).summary).toContain(
      'all square',
    );
    expect(groupWidget({ ...part, archived: true }, setup, size, auth, now).summary).toContain(
      'final',
    );
    expect(groupWidget(part, setup, size, auth, now + 86400001).summary).toContain(
      'Open to update',
    );
    const lost = groupWidget(null, setup, size, auth, now).summary;
    expect(lost).toContain('no longer in this Group');
    expect(lost).not.toMatch(/Maple|Priya|₹/);
    const other = groupWidget(part, setup, size, { ...auth, accountId: 'sam' }, now).summary;
    expect(other).toContain('Set up this widget again');
    expect(other).not.toMatch(/Maple|Priya|₹/);
  },
);
it.each(['1x1', '2x1'] as const)(
  'announces each Add expense state at %s, without disclosing the saved Group when unavailable',
  (size) => {
    const quick = { ...setup, kind: 'quick' as const };
    for (const status of ['signed-out', 'expired'] as const) {
      const v = quickWidget(copy, quick, size, { status });
      expect(v.summary).toContain('Sign in');
      expect(v.summary).not.toContain('Maple');
    }
    expect(quickWidget(copy, { ...quick, groupId: null }, size, auth).summary).toContain(
      'Choose a Group',
    );
    expect(quickWidget(copy, quick, size, { ...auth, accountId: 'sam' }).summary).toBe(
      'Set up again. Another account',
    );
    expect(quickWidget({ ...copy, lostGroupIds: ['maple'] }, quick, size, auth).summary).toBe(
      'Not in this Group. Choose a Group',
    );
    expect(
      quickWidget({ ...copy, groups: { maple: { ...part, archived: true } } }, quick, size, auth)
        .summary,
    ).toBe('Group archived. Choose another');
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
  expect(groupWidget(multi, setup, '2x2', auth, now).summary).toContain('You owe ₹1,480.00');
  expect(groupWidget(multi, setup, '2x2', auth, now).summary).toContain('In 3\u00a0currencies');
  expect(groupWidget(multi, setup, '4x2', auth, now).summary).toContain('+1\u00a0more');
});

it('names the extra currency when compact Balances omits it', () => {
  expect(balancesWidget(copy, { kind: 'balances' }, '2x1', auth, now).summary).toContain(
    '1 more currency owed',
  );
});
