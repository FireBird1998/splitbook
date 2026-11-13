import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { overviewWidget } from './overview-widget';
import { widgetText } from './widget-sizing';
import type { WidgetCopy } from './balances-widget';
const now = Date.parse('2026-11-13T04:11:00Z');
beforeAll(() => vi.stubEnv('TZ', 'Asia/Kolkata'));
afterAll(() => vi.unstubAllEnvs());
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup = { kind: 'balances' as const, widgetId: 7 };
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: {
    verifiedAt: now,
    groupCount: 4,
    currencies: [
      { currency: 'INR', owedMinor: 240000, oweMinor: 148000 },
      { currency: 'EUR', owedMinor: 4000, oweMinor: 0 },
      { currency: 'JPY', owedMinor: 42000, oweMinor: 0 },
    ],
  },
  review: { count: 3, verifiedAt: now },
};
it('keeps the small Balances content and makes a tall Overview with review and Add expense targets', () => {
  const small = overviewWidget(copy, setup, { width: 172, height: 224 }, auth, now);
  expect(small.heading).toBe('Balances');
  expect(small.owed).toEqual(['₹2,400.00', '€40.00']);
  expect(small.owedOverflow).toBe('+1\u00a0currency');
  expect(small.review).toBe('To review\u00a0· 3');
  expect(small.reviewTarget).toBe('review');
  expect(small.action).toBeNull();
  const tall = overviewWidget(copy, setup, { width: 360, height: 344 }, auth, now);
  expect(tall.heading).toBe('Overview');
  expect(tall.owed).toEqual(['₹2,400.00', '€40.00']);
  expect(tall.action).toBe('＋ Add expense');
  expect(tall.actionTarget).toBe('choose-group');
  expect(tall.summary.indexOf('You’re owed')).toBeLessThan(tall.summary.indexOf('To review'));
});

const sizes = [
  { width: 172, height: 104 },
  { width: 172, height: 224 },
  { width: 172, height: 344 },
  { width: 172, height: 464 },
  { width: 266, height: 280 },
  { width: 360, height: 224 },
  { width: 360, height: 344 },
  { width: 360, height: 464 },
  { width: 360, height: 584 },
  { width: 231, height: 257 },
  { width: 301, height: 353 },
  { width: 640, height: 640 },
];
it.each(sizes.flatMap((size) => [1, 1.3, 2].map((scale) => ({ ...size, scale }))))(
  'fits real $width×$height dp at $scale text',
  ({ width, height, scale }) => {
    const v = overviewWidget(copy, setup, { width, height, pixelRatio: 2.625 }, auth, now, scale),
      l = v.layout;
    expect(l.fits).toBe(true);
    const pixels = (dp: number) => Math.round(dp * 2.625);
    expect(
      l.sections.reduce((n, s) => n + pixels(s.height), 0) +
        Math.max(0, l.sections.length - 1) * pixels(l.gap) +
        pixels(l.padding) * 2,
    ).toBeLessThanOrEqual(Math.floor(height * 2.625));
    expect(l.sections[0]?.id).toBe(l.showHeader ? 'header' : 'balance');
    expect(v.owed.length).toBeGreaterThan(0);
    expect(v.owe.length).toBeGreaterThan(0);
    expect(v.owed[0]).toBe('₹2,400.00');
    expect(v.owe[0]).toBe('₹1,480.00');
  },
);
const states = [
  'all-square',
  'no-groups',
  'no-copy',
  'signed-out',
  'expired',
  'other-account',
  'loading',
  'hidden',
  'old',
] as const;
it.each(
  states.flatMap((state) =>
    [
      { width: 172, height: 104 },
      { width: 360, height: 584 },
    ].flatMap((size) => [1, 1.3, 2].map((scale) => ({ state, size, scale }))),
  ),
)('fits $state at $size and $scale text', ({ state, size, scale }) => {
  const c =
    state === 'no-copy' || state === 'loading'
      ? null
      : state === 'all-square'
        ? { ...copy, home: { ...copy.home!, currencies: [] } }
        : state === 'no-groups'
          ? { ...copy, home: { ...copy.home!, groupCount: 0, currencies: [] } }
          : state === 'other-account'
            ? { ...copy, accountId: 'sam' }
            : copy;
  const session =
    state === 'signed-out' || state === 'expired'
      ? { status: state }
      : state === 'loading'
        ? { ...auth, loading: true }
        : auth;
  const v = overviewWidget(
    c,
    { ...setup, hideAmounts: state === 'hidden' },
    size,
    session,
    state === 'old' ? now + 86400001 : now,
    scale,
  );
  expect(v.layout.fits).toBe(true);
  if (['signed-out', 'expired', 'other-account', 'no-copy', 'loading'].includes(state))
    expect(JSON.stringify(v)).not.toMatch(/2,400|1,480|40.00|42000/);
  if (state === 'hidden') {
    expect(v.hidden).toBe('Amounts hidden');
    expect(JSON.stringify(v)).not.toMatch(/₹|€|¥|2,400/);
  }
  if (state === 'old') {
    expect(v.muted).toBe(true);
    expect(v.review).toBeNull();
  }
  if (!['loading', 'hidden', 'old'].includes(state)) expect(v.state).toBe(state);
});
it('uses three currencies on a taller wide widget, keeping yen exact and Home order', () => {
  const v = overviewWidget(copy, setup, { width: 360, height: 584 }, auth, now);
  expect(v.owed).toEqual(['₹2,400.00', '€40.00', '¥42,000']);
  expect(v.owedOverflow).toBeNull();
});
it('keeps the message together on a tall widget instead of spreading its lines', () => {
  const v = overviewWidget(copy, setup, { width: 360, height: 584 }, { status: 'expired' }, now);
  const s = v.layout.sections.find((s) => s.id === 'message')!;
  expect(s.height).toBe(s.rowHeight);
  expect(v.layout.sections.find((s) => s.id === 'space')!.height).toBeGreaterThan(350);
});
it('keeps the separately verified count with Hide amounts and omits it with Drafts off', () => {
  const v = overviewWidget(
    copy,
    { ...setup, hideAmounts: true },
    { width: 360, height: 344 },
    auth,
    now,
  );
  expect(v.review).toBe('To review\u00a0· 3');
  expect(
    overviewWidget(copy, { ...setup, reviewEnabled: false }, { width: 360, height: 344 }, auth, now)
      .review,
  ).toBeNull();
});

it('keeps full large amounts within their column, or uses the established readable fallback', () => {
  const large = {
    ...copy,
    home: {
      ...copy.home!,
      currencies: [{ currency: 'INR', owedMinor: 123456789012345, oweMinor: 99999999999999 }],
    },
  };
  for (const size of [
    { width: 172, height: 104 },
    { width: 172, height: 224 },
    { width: 360, height: 344 },
  ]) {
    const v = overviewWidget(large, setup, size, auth, now, 2),
      l = v.layout;
    if (l.compactFallback) {
      expect(l.compactFallback).toBe('Open to see balances');
      continue;
    }
    const room = l.columns ? (l.width - 8) / 2 - (l.panel ? 20 : 0) : l.width;
    for (const amount of [...v.owed, ...v.owe])
      expect(widgetText(room, 2).width(amount, l.fonts.money, true)).toBeLessThanOrEqual(room);
  }
});

it.each(['signed-out', 'expired', 'all-square'] as const)(
  'keeps the board action in the %s state',
  (state) => {
    const c = state === 'all-square' ? { ...copy, home: { ...copy.home!, currencies: [] } } : copy;
    const session = state === 'all-square' ? auth : { status: state };
    const v = overviewWidget(c, setup, { width: 360, height: 344 }, session, now);
    expect(v.action).toBe(state === 'all-square' ? '＋ Add expense' : 'Sign in');
    expect(v.actionTarget).toBe(state === 'all-square' ? 'choose-group' : 'sign-in');
  },
);
it('keeps the To review chip drawn at 130% on the tall board', () => {
  expect(overviewWidget(copy, setup, { width: 360, height: 344 }, auth, now, 1.3).review).toBe(
    'To review\u00a0· 3',
  );
});
it.each([1, 1.3, 2])(
  'budgets the old-copy update note together with its action at %s text',
  (scale) => {
    const v = overviewWidget(copy, setup, { width: 360, height: 584 }, auth, now + 86400001, scale),
      l = v.layout;
    expect(l.footerNote).toBe('Open to update');
    expect(v.action).toBe('＋ Add expense');
    const text = widgetText(l.width, scale);
    const actionHeight = l.actionLines.length * text.line(l.fonts.action) + 18;
    const noteHeight = text.line(l.fonts.small);
    expect(l.sections.find((s) => s.id === 'footer')!.height).toBeGreaterThanOrEqual(
      l.footerAcross ? Math.max(actionHeight, noteHeight) : actionHeight + noteHeight + 4,
    );
  },
);
it('reserves the small currency hint and secondary amount before choosing a money font', () => {
  const c = {
    ...copy,
    home: {
      ...copy.home!,
      currencies: [
        { currency: 'INR', owedMinor: 1234567890, oweMinor: 9876543210 },
        { currency: 'EUR', owedMinor: 1, oweMinor: 0 },
      ],
    },
  };
  const v = overviewWidget(c, setup, { width: 172, height: 104 }, auth, now),
    l = v.layout;
  const t = widgetText(l.width);
  expect(
    t.width(l.primary.amount, l.fonts.money, true) +
      (l.showOverflow && l.primary.overflow ? 4 + t.width(l.primary.overflow, l.fonts.small) : 0),
  ).toBeLessThanOrEqual(l.width + 0.000001);
  expect(t.width(l.secondary ?? '', l.fonts.secondary)).toBeLessThanOrEqual(l.width + 0.000001);
});
