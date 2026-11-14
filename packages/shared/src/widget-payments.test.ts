import { expect, it } from 'vitest';
import { widgetPayments } from './widget-payments';
import type { WidgetCopy } from './balances-widget';
import type { WidgetGroupPart } from './group-widget';
const now = Date.parse('2026-11-13T04:11:00Z');
const group = (
  id: string,
  currency: string,
  incoming: boolean,
  minor: number,
): WidgetGroupPart => ({
  id,
  name: id === 'maple' ? 'Maple House' : 'Goa Friends Trip',
  theme: 'home',
  archived: false,
  mainCurrency: currency,
  verifiedAt: now - 1000,
  balancesVerifiedAt: now,
  currencies: [
    {
      currency,
      balanceMinor: incoming ? minor : -minor,
      payments: [
        {
          from: incoming ? 'sam' : 'alex',
          to: incoming ? 'alex' : 'sam',
          fromName: incoming ? 'Sam' : 'Alex',
          toName: incoming ? 'Alex' : 'Sam',
          fromInitials: incoming ? 'SC' : 'AR',
          toInitials: incoming ? 'AR' : 'SC',
          amountMinor: minor,
        },
      ],
    },
  ],
});
const maple = group('maple', 'INR', false, 42000);
const goa = group('goa', 'JPY', false, 42000);
const outgoing = group('goa', 'INR', false, 106000).currencies[0];
outgoing.payments[0].to = 'priya';
outgoing.payments[0].toName = 'Priya';
outgoing.payments[0].toInitials = 'PS';
goa.currencies.push(outgoing, ...group('goa', 'EUR', false, 4000).currencies);
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: {
    verifiedAt: now - 5000,
    groupCount: 3,
    currencies: [
      { currency: 'INR', owedMinor: 39000, oweMinor: 42000 },
      { currency: 'EUR', owedMinor: 0, oweMinor: 4000 },
      { currency: 'JPY', owedMinor: 0, oweMinor: 42000 },
    ],
  },
  groups: { maple, goa, kerala: group('kerala', 'INR', true, 145000) },
};
it('orders pay before paid, then Home currencies, and amounts only within their currency', () => {
  const rows = widgetPayments(copy, 'alex');
  expect(rows.map((r) => [r.incoming, r.currency, r.amountMinor])).toEqual([
    [false, 'INR', 106000],
    [false, 'INR', 42000],
    [false, 'EUR', 4000],
    [false, 'JPY', 42000],
    [true, 'INR', 145000],
  ]);
  expect(rows.find((r) => r.currency === 'JPY')?.amount).toBe('¥42,000');
  expect(rows[1]).toMatchObject({
    groupName: 'Maple House',
    firstName: 'Sam',
    initials: 'SC',
    verifiedAt: now - 1000,
    target: {
      kind: 'settle',
      groupId: 'maple',
      payment: { from: 'alex', to: 'sam', currency: 'INR' },
    },
  });
});

it('leaves out archived, refused and other-account parts and payments between other people', () => {
  const archived = { ...group('old', 'INR', false, 999999), archived: true };
  const other = group('other', 'INR', false, 70000);
  other.currencies[0]!.payments[0]!.from = 'priya';
  const c = { ...copy, groups: { ...copy.groups, old: archived, other }, lostGroupIds: ['maple'] };
  expect(widgetPayments(c, 'alex').map((r) => r.groupId)).not.toContain('old');
  expect(widgetPayments(c, 'alex').map((r) => r.groupId)).not.toContain('maple');
  expect(widgetPayments(c, 'alex').map((r) => r.groupId)).not.toContain('other');
  expect(widgetPayments(c, 'sam')).toEqual([]);
});
it('keeps a Group read time independently of Home and never nets opposite directions', () => {
  const c = {
    ...copy,
    groups: { maple: group('maple', 'INR', false, 10000), goa: group('goa', 'INR', true, 10000) },
  };
  const rows = widgetPayments(c, 'alex');
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.amountMinor)).toEqual([10000, 10000]);
  expect(rows.map((r) => r.verifiedAt)).toEqual([now - 1000, now - 1000]);
  expect(c.home!.verifiedAt).toBe(now - 5000);
});

it.each(['Group', 'Balances'] as const)(
  'dates the payment by the older read when %s is old',
  (old) => {
    const part = {
      ...maple,
      verifiedAt: old === 'Group' ? now - 86400001 : now,
      balancesVerifiedAt: old === 'Balances' ? now - 86400001 : now,
    };
    expect(widgetPayments({ ...copy, groups: { maple: part } }, 'alex')[0].verifiedAt).toBe(
      now - 86400001,
    );
  },
);
