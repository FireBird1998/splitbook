import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balancesWidget, type WidgetCopy } from '@splitbook/shared/balances-widget';

const now = Date.parse('2026-11-08T04:11:00Z');
export const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: {
    verifiedAt: now,
    groupCount: 4,
    currencies: [
      { currency: 'INR', owedMinor: 240000, oweMinor: 148000 },
      { currency: 'EUR', owedMinor: 4000, oweMinor: 1250 },
      { currency: 'JPY', owedMinor: 3000, oweMinor: 0 },
    ],
  },
  review: { count: 3, verifiedAt: now },
};
const previousZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Kolkata';
});
afterAll(() => {
  process.env.TZ = previousZone;
});
describe('Balances widget view', () => {
  it('keeps owed and owe separate, in Home currency order, and marks the saved time', () => {
    expect(
      balancesWidget(
        copy,
        { kind: 'balances' },
        '2x2',
        { status: 'authenticated', accountId: 'alex', loading: false },
        now,
      ),
    ).toMatchObject({
      state: 'normal',
      saved: 'Saved 9:41',
      muted: false,
      owed: ['₹2,400.00', '€40.00'],
      owe: ['₹1,480.00', '€12.50'],
      owedOverflow: '+1 currency',
      review: 'To review · 3',
      target: 'home',
    });
  });
});
