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
it('never speaks amounts or names when hidden, even the visible Group name', () => {
  const b = balancesWidget(copy, { kind: 'balances', hideAmounts: true }, '2x2', auth, now).summary;
  const g = groupWidget(part, { ...setup, hideAmounts: true }, '4x2', auth, now).summary;
  expect(b).toContain('Amounts hidden');
  expect(g).toContain('You owe 1\u00a0person');
  expect(g).toContain('Amounts and names hidden');
  expect(b + g).not.toMatch(/₹|€|1,480|2,400|40\.00|Maple|Priya|Shah|Alex/);
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
