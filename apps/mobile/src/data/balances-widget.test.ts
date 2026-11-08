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
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const view = (value: WidgetCopy | null = copy, size: '2x1' | '2x2' | '4x2' = '2x2', at = now) =>
  balancesWidget(value, { kind: 'balances' }, size, auth, at);
it.each(['2x1', '2x2', '4x2'] as const)(
  'hides every amount in %s for signed-out and expired sessions',
  (size) => {
    for (const status of ['signed-out', 'expired'] as const) {
      const shown = balancesWidget(copy, { kind: 'balances' }, size, { status }, now);
      expect(shown).toMatchObject({
        state: status,
        owed: [],
        owe: [],
        review: null,
        saved: null,
        target: 'sign-in',
      });
      expect(shown.title).toBe(status === 'expired' ? 'Sign in again' : 'Sign in to Splitbook');
    }
  },
);
it('distinguishes loading from no saved copy and never invents all square', () => {
  expect(view(null)).toMatchObject({ state: 'no-copy', title: 'Nothing saved yet' });
  expect(
    balancesWidget(null, { kind: 'balances' }, '2x2', { ...auth, loading: true }, now),
  ).toMatchObject({ state: 'loading', owed: [], owe: [], title: null });
  expect(view({ ...copy, accountId: 'sam' })).toMatchObject({
    state: 'no-copy',
    owed: [],
    owe: [],
    saved: null,
  });
});
it('shows JPY without decimals at 4×2, with up to three currencies per column', () => {
  expect(view(copy, '4x2')).toMatchObject({
    owed: ['₹2,400.00', '€40.00', '¥3,000'],
    owe: ['₹1,480.00', '€12.50'],
    owedOverflow: null,
    footer: 'Across 4 Groups',
    review: 'To review · 3',
  });
});
it('at 2×1 keeps the first currency of each side, the saved time and no review chip', () => {
  expect(view(copy, '2x1')).toMatchObject({
    owed: ['₹2,400.00'],
    owe: ['₹1,480.00'],
    owedOverflow: '+2',
    oweOverflow: '+1',
    review: null,
    saved: 'Saved 9:41',
  });
});
it('at 2×1 uses You owe when nothing is owed to the member', () => {
  expect(
    view(
      {
        ...copy,
        home: { ...copy.home!, currencies: [{ currency: 'JPY', owedMinor: 0, oweMinor: 3000 }] },
      },
      '2x1',
    ),
  ).toMatchObject({ state: 'normal', owed: [], owe: ['¥3,000'] });
});
it.each(['2x1', '2x2', '4x2'] as const)(
  'distinguishes a verified all-square balance from no Groups at %s',
  (size) => {
    expect(view({ ...copy, home: { ...copy.home!, currencies: [] } }, size)).toMatchObject({
      state: 'all-square',
      title: 'You’re all square',
      saved: 'Saved 9:41',
    });
    expect(
      view({ ...copy, home: { ...copy.home!, groupCount: 0, currencies: [] } }, size),
    ).toMatchObject({ state: 'no-groups', title: 'No Groups yet', target: 'create-group' });
  },
);
it('counts every currency that does not fit, without converting or netting', () => {
  const multi = {
    ...copy,
    home: {
      ...copy.home!,
      currencies: [
        ...copy.home!.currencies,
        { currency: 'USD', owedMinor: 1000, oweMinor: 0 },
        { currency: 'GBP', owedMinor: 2000, oweMinor: 0 },
      ],
    },
  };
  expect(view(multi)).toMatchObject({ owedOverflow: '+3 currencies' });
  expect(view(multi, '4x2')).toMatchObject({
    owedOverflow: '+2 currencies',
    owed: ['₹2,400.00', '€40.00', '¥3,000'],
  });
});
it.each([
  ['2026-11-08T00:01:00+05:30', '2026-11-07T23:59:00+05:30', 'Saved Sat'],
  ['2026-11-08T09:41:00+05:30', '2026-11-02T09:41:00+05:30', 'Saved Mon'],
  ['2026-11-08T09:41:00+05:30', '2026-11-01T09:41:00+05:30', 'Saved 1 Nov'],
  ['2026-11-11T09:41:00+05:30', '2026-11-03T09:41:00+05:30', 'Saved 3 Nov'],
])('labels local saved dates at %s', (clock, saved, expected) => {
  expect(
    view(
      { ...copy, home: { ...copy.home!, verifiedAt: Date.parse(saved) } },
      '2x2',
      Date.parse(clock),
    ).saved,
  ).toBe(expected);
});
it('mutes only after 24 elapsed hours, across local midnight, and offers Open to update', () => {
  expect(view(copy, '2x2', now + 86_400_000)).toMatchObject({ muted: false });
  expect(view(copy, '2x2', now + 86_400_001)).toMatchObject({
    muted: true,
    footer: 'Open to update',
    review: null,
  });
});
it('omits the review chip without a separately verified count', () => {
  const { review: _review, ...without } = copy;
  expect(view(without).review).toBeNull();
  expect(view({ ...copy, review: { count: 0, verifiedAt: now } }).review).toBeNull();
});
