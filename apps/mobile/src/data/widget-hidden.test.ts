import { afterAll, beforeAll, expect, it } from 'vitest';
import { balancesWidget, type WidgetCopy } from '@splitbook/shared/balances-widget';
import { groupWidget, type WidgetGroupPart } from '@splitbook/shared/group-widget';
import { widgetSetupChoices } from '@splitbook/shared/widget-setup';
const previousZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Kolkata';
});
afterAll(() => {
  process.env.TZ = previousZone;
});
const now = Date.parse('2026-11-09T04:11:00Z');
const session = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup = {
  kind: 'group' as const,
  groupId: 'maple',
  widgetId: 7,
  accountId: 'alex',
  hideAmounts: true,
};
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
          amountMinor: 106000,
        },
        {
          from: 'alex',
          to: 'sam',
          fromName: 'Alex Rivera',
          toName: 'Sam Chen',
          amountMinor: 42000,
        },
        {
          from: 'sam',
          to: 'priya',
          fromName: 'Sam Chen',
          toName: 'Priya Shah',
          amountMinor: 90000,
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
};
const privateOutput = (view: unknown) =>
  expect(JSON.stringify(view)).not.toMatch(
    /₹|€|¥|1,480|2,400|1,060|420\.00|Priya|Sam|Alex|Shah|Chen|amountMinor|fromName|toName/,
  );
it.each(['2x1', '2x2', '4x2'] as const)(
  'hides every Balances amount at %s and keeps currency counts and saved time',
  (size) => {
    const v = balancesWidget(copy, { kind: 'balances', hideAmounts: true }, size, session, now);
    expect(v).toMatchObject({
      owed: ['in 2\u00a0currencies'],
      owe: ['in 1\u00a0currency'],
      hidden: 'Amounts hidden',
      saved: 'Saved 9:41',
      owedOverflow: null,
      oweOverflow: null,
    });
    privateOutput(v);
    for (const state of [
      { status: 'signed-out' as const },
      { status: 'expired' as const },
      { ...session, accountId: 'other' },
      { ...session, loading: true },
    ])
      privateOutput(
        balancesWidget(copy, { kind: 'balances', hideAmounts: true }, size, state, now),
      );
    for (const home of [
      null,
      { ...copy.home!, groupCount: 0, currencies: [] },
      { ...copy.home!, currencies: [] },
    ])
      privateOutput(
        balancesWidget(
          { ...copy, home },
          { kind: 'balances', hideAmounts: true },
          size,
          session,
          now + 86400001,
        ),
      );
    privateOutput(
      balancesWidget(
        null,
        { kind: 'balances', hideAmounts: true },
        size,
        { ...session, loading: true },
        now,
      ),
    );
    expect(
      balancesWidget(copy, { kind: 'balances', hideAmounts: true }, size, session, now + 86400001),
    ).toMatchObject({ muted: true, footer: 'Open to update', hidden: 'Amounts hidden' });
  },
);
it.each(['2x2', '4x2', '4x3'] as const)(
  'hides every Group amount, payment identity and payment target at %s',
  (size) => {
    const v = groupWidget(part, setup, size, session, now);
    expect(v).toMatchObject({
      name: 'Maple House',
      saved: 'Saved 9:41',
      balance: 'You owe 2\u00a0people',
      payments: [],
      compactAmount: null,
      people: null,
      more: null,
      hidden: 'Amounts and names hidden',
    });
    privateOutput(v);
    for (const state of [
      { status: 'signed-out' as const },
      { status: 'expired' as const },
      { ...session, accountId: 'other' },
    ])
      privateOutput(groupWidget(part, setup, size, state, now));
    for (const value of [null, undefined, { ...part, archived: true }, { ...part, currencies: [] }])
      privateOutput(groupWidget(value, setup, size, session, now));
    privateOutput(groupWidget(undefined, setup, size, { ...session, loading: true }, now));
    expect(groupWidget({ ...part, archived: true }, setup, size, session, now)).toMatchObject({
      final: true,
      addExpense: false,
      balance: 'You owe 2\u00a0people\u00a0· final',
    });
  },
);
it('counts distinct people separately in each direction across currencies without netting', () => {
  const currencies = [
    ...part.currencies,
    {
      currency: 'JPY',
      balanceMinor: 3000,
      payments: [
        {
          from: 'priya',
          to: 'alex',
          fromName: 'Priya Shah',
          toName: 'Alex Rivera',
          amountMinor: 3000,
        },
      ],
    },
    ...part.currencies,
  ];
  const v = groupWidget({ ...part, currencies }, setup, '4x2', session, now);
  expect(v.balance).toBe('You owe 2\u00a0people\u00a0· You’re owed by 1\u00a0person');
  privateOutput(v);
});
it('defaults to visible amounts and restores the current per-widget hide and Group choices', () => {
  expect(widgetSetupChoices('balances', null, 'alex', null)).toEqual({
    groupId: null,
    hideAmounts: false,
  });
  expect(widgetSetupChoices('group', setup, 'alex', 'other')).toEqual({
    groupId: 'maple',
    hideAmounts: true,
  });
  expect(widgetSetupChoices('group', setup, 'sam', 'other')).toEqual({
    groupId: 'other',
    hideAmounts: true,
  });
  expect(
    widgetSetupChoices(
      'balances',
      { kind: 'balances', widgetId: 3, hideAmounts: true },
      'alex',
      null,
    ),
  ).toEqual({ groupId: null, hideAmounts: true });
});
it.each([null, 'maple'])(
  'reopens Add expense with its current target %s through the setup seam',
  (groupId) => {
    expect(
      widgetSetupChoices(
        'quick',
        { kind: 'quick', widgetId: 9, accountId: 'alex', groupId },
        'alex',
        'other',
      ),
    ).toEqual({ groupId, hideAmounts: false });
    expect(widgetSetupChoices('quick', null, 'alex', 'other')).toEqual({
      groupId: null,
      hideAmounts: false,
    });
  },
);
