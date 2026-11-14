import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { overviewWidget } from './overview-widget';
import { widgetText } from './widget-sizing';
import type { WidgetCopy } from './balances-widget';
const clone = (value: WidgetCopy): WidgetCopy => JSON.parse(JSON.stringify(value));
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
    expect(JSON.stringify(v)).not.toMatch(/2,400|1,480|40\.00|42000/);
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
  const before = v.layout.sections.find((s) => s.id === 'message-before')!;
  const after = v.layout.sections.find((s) => s.id === 'message-after')!;
  expect(before.height).toBeGreaterThan(150);
  expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(1);
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
    if (scale === 2) {
      expect(v.action).toBeNull();
      expect(l.footerNote).toBeNull();
      expect(l.sections.some((s) => s.id === 'footer')).toBe(false);
      return;
    }
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

it.each([
  ['expired', 'to see balances', 'to see your Overview. It comes back once you do.'],
  ['signed-out', 'to see your balances here', 'to see your balances, payments and Groups here.'],
  [
    'no-copy',
    'Open Splitbook to load your balances.',
    'Open Splitbook to load your balances, payments and Groups.',
  ],
  ['no-groups', 'Share costs with a Group.', 'Share costs with a Group, and it shows here.'],
] as const)(
  'keeps small words and uses the tall board sentence for %s',
  (state, smallWords, tallWords) => {
    const c =
      state === 'no-copy'
        ? null
        : state === 'no-groups'
          ? { ...copy, home: { ...copy.home!, groupCount: 0 } }
          : copy;
    const session = state === 'expired' || state === 'signed-out' ? { status: state } : auth;
    expect(overviewWidget(c, setup, { width: 172, height: 224 }, session, now).description).toBe(
      smallWords,
    );
    expect(overviewWidget(c, setup, { width: 360, height: 344 }, session, now).description).toBe(
      tallWords,
    );
  },
);

it('keeps fitting compact balance amounts at 200 percent without testing an undrawn secondary line', () => {
  const v = overviewWidget(
    copy,
    setup,
    { width: 172, height: 104, pixelRatio: 2.625 },
    auth,
    now,
    2,
  );
  expect(v.layout.compactLines).toEqual(['Owed ₹2,400.00', 'Owe ₹1,480.00']);
  expect(v.layout.compactFallback).toBeNull();
});

it.each([344, 584])('has no ordinary footer at 200 percent, including height %s', (height) => {
  const v = overviewWidget(copy, setup, { width: 360, height, pixelRatio: 2.625 }, auth, now, 2);
  expect(v.action).toBeNull();
  expect(v.review).toBeNull();
  expect(v.layout.sections.some((s) => s.id === 'footer')).toBe(false);
});
it('restores Across N Groups beside the review chip in the small wide layout', () => {
  const v = overviewWidget(copy, setup, { width: 360, height: 224, pixelRatio: 2.625 }, auth, now);
  expect(v.review).toBe('To review\u00a0· 3');
  expect(v.layout.footerNote).toBe('Across 4\u00a0Groups');
});
it.each(['signed-out', 'expired', 'no-groups'] as const)(
  'reserves a right-aligned complete button and centres the tall %s message',
  (state) => {
    const c =
      state === 'no-groups'
        ? { ...copy, home: { ...copy.home!, groupCount: 0, currencies: [] } }
        : copy;
    const session = state === 'no-groups' ? auth : { status: state };
    const v = overviewWidget(
      c,
      setup,
      { width: 360, height: 584, pixelRatio: 2.625 },
      session,
      now,
    );
    expect(v.action).toBe(state === 'no-groups' ? '＋ Create a Group' : 'Sign in');
    const ids = v.layout.sections.map((s) => s.id);
    const message = ids.indexOf('message');
    expect(ids[message - 1]).toBe('message-before');
    expect(ids[message + 1]).toBe('message-after');
    expect(v.layout.sections[message - 1].height).toBeCloseTo(
      v.layout.sections[message + 1].height,
      0,
    );
    expect(v.layout.sections.at(-1)?.id).toBe('footer');
  },
);
const paymentCopy: WidgetCopy = {
  ...copy,
  groups: {
    maple: {
      id: 'maple',
      name: 'Maple House',
      theme: 'home',
      archived: false,
      mainCurrency: 'INR',
      verifiedAt: now,
      balancesVerifiedAt: now - 86400001,
      currencies: [
        {
          currency: 'INR',
          balanceMinor: -140000,
          payments: Array.from({ length: 4 }, (_, i) => ({
            from: i === 4 ? 'sam' : 'alex',
            to: i === 4 ? 'alex' : ['sam', 'priya', 'ravi', 'kai'][i]!,
            fromName: i === 4 ? 'Sam Chen' : 'Alex Rao',
            toName: i === 4 ? 'Alex Rao' : ['Sam Chen', 'Priya Shah', 'Ravi Kapoor', 'Kai Tan'][i]!,
            fromInitials: i === 4 ? 'SC' : 'AR',
            toInitials: i === 4 ? 'AR' : ['SC', 'PS', 'RK', 'KT'][i]!,
            amountMinor: (5 - i) * 10000,
          })),
        },
      ],
    },
    goa: {
      id: 'goa',
      name: 'Goa Friends Trip',
      theme: 'trip',
      archived: false,
      mainCurrency: 'EUR',
      verifiedAt: now,
      balancesVerifiedAt: now,
      currencies: [
        {
          currency: 'EUR',
          balanceMinor: 10000,
          payments: [
            {
              from: 'sam',
              to: 'alex',
              fromName: 'Sam Chen',
              toName: 'Alex Rao',
              fromInitials: 'SC',
              toInitials: 'AR',
              amountMinor: 10000,
            },
          ],
        },
      ],
    },
  },
};
it('shows across-Group payments after balances with a Home overflow link and independent old time', () => {
  const v = overviewWidget(paymentCopy, setup, { width: 360, height: 344 }, auth, now);
  expect(v.payments).toHaveLength(2);
  expect(v.payments[0]).toMatchObject({
    label: 'You pay Sam',
    groupName: 'Maple House',
    amount: '₹500.00',
    initials: 'SC',
    muted: true,
    target: {
      kind: 'settle',
      groupId: 'maple',
      payment: { from: 'alex', to: 'sam', currency: 'INR' },
    },
  });
  expect(v.paymentMore).toBe('+3\u00a0more');
  expect(v.paymentMoreTarget).toBe('home');
  expect(v.layout.sections.map((s) => s.id)).toEqual([
    'header',
    'balance',
    'payments',
    'space',
    'footer',
  ]);
  expect(v.summary.indexOf('You pay Sam')).toBeGreaterThan(v.summary.indexOf('You owe'));
  expect(v.summary.indexOf('You pay Sam')).toBeLessThan(v.summary.indexOf('To review'));
  expect(v.summary).toContain('in Maple House');
});
it('shortens narrow payments and replaces hidden rows with counts without names or money', () => {
  const v = overviewWidget(paymentCopy, setup, { width: 172, height: 464 }, auth, now);
  expect(v.payments[0]?.label).toBe('Pay Sam');
  const h = overviewWidget(
    paymentCopy,
    { ...setup, hideAmounts: true },
    { width: 360, height: 584 },
    auth,
    now,
  );
  expect(h.payments).toEqual([]);
  expect(h.layout.paymentCountsLines).toEqual(['You pay 4 people', '1 person pays you']);
  expect(JSON.stringify(h)).not.toMatch(/Sam|Maple|500/);
  const incoming = clone(paymentCopy);
  incoming.groups!.maple!.currencies[0]!.payments =
    incoming.groups!.maple!.currencies[0]!.payments.slice(4);
  expect(
    overviewWidget(incoming, setup, { width: 172, height: 464 }, auth, now).payments[0]?.label,
  ).toBe('From Sam');
});
it.each(sizes.flatMap((size) => [1, 1.3, 2].map((scale) => ({ ...size, scale }))))(
  'fits payment text and section heights at $width×$height with $scale text',
  ({ width, height, scale }) => {
    const v = overviewWidget(
        paymentCopy,
        setup,
        { width, height, pixelRatio: 2.625 },
        auth,
        now,
        scale,
      ),
      l = v.layout;
    expect(l.fits).toBe(true);
    expect(
      l.sections.reduce((n, s) => n + s.height, 0) +
        Math.max(0, l.sections.length - 1) * l.gap +
        l.padding * 2,
    ).toBeLessThanOrEqual(height + 0.00001);
    for (const row of v.payments) expect(row.textHeight).toBeLessThanOrEqual(row.contentHeight);
    if (!v.payments.length) expect(v.paymentMore).toBeNull();
    if (!l.compactPayments)
      for (const row of v.payments)
        expect(row.groupName).toBe(row.groupId === 'maple' ? 'Maple House' : 'Goa Friends Trip');
  },
);
it('keeps payments out of small and all-square layouts and asks for an unread Group without a new request', () => {
  expect(
    overviewWidget(paymentCopy, setup, { width: 360, height: 224 }, auth, now).payments,
  ).toEqual([]);
  expect(
    overviewWidget(
      { ...paymentCopy, home: { ...copy.home!, currencies: [] } },
      setup,
      { width: 360, height: 584 },
      auth,
      now,
    ).payments,
  ).toEqual([]);
  expect(
    overviewWidget(copy, setup, { width: 360, height: 344 }, auth, now).layout.paymentMessageLines,
  ).toEqual(['Open the Group to update']);
});

it('uses the Group spoken-name rule when two people share initials and another differs', () => {
  const c = clone(paymentCopy);
  const rows = c.groups!.maple!.currencies[0]!.payments;
  rows.splice(3);
  for (const [i, row] of rows.entries()) {
    row.toName = 'Priya';
    row.toInitials = i === 2 ? 'PK' : 'PS';
  }
  const v = overviewWidget(c, setup, { width: 360, height: 584 }, auth, now);
  expect(v.summary).toContain('You pay Priya ₹500.00 in Maple House');
  expect(v.summary).toContain('You pay Priya ₹400.00 in Maple House');
  expect(v.summary).toContain('You pay Priya K ₹300.00 in Maple House');
  expect(v.summary).not.toContain('Priya S');
});

it('uses a count without a link or padded rows when no full-style payment row fits', () => {
  const c = clone(paymentCopy);
  c.home!.currencies = [{ currency: 'INR', owedMinor: 0, oweMinor: 100000 }];
  delete c.groups!.goa;
  const g = c.groups!.maple!;
  g.currencies[0].payments = [
    {
      from: 'alex',
      to: 'sam',
      fromName: 'Alex',
      toName: 'Ananthapadmanabhan',
      fromInitials: 'AR',
      toInitials: 'AS',
      amountMinor: 9007199254740991,
    },
  ];
  g.currencies[0].currency = 'JPY';
  const v = overviewWidget(c, setup, { width: 240, height: 280, pixelRatio: 2.625 }, auth, now);
  expect(v.payments).toEqual([]);
  expect(v.paymentMore).toBeNull();
  expect(v.paymentCount).toBe('1\u00a0payment');
  expect(v.layout.compactPayments).toBe(false);
  expect(
    v.layout.sections.find((s) => s.id === 'payments')!.height - v.layout.paymentHeaderHeight,
  ).toBeLessThan(1);
});

it.each([390, 390.5, 391])(
  'reserves the drawn divider for stacked payment text at %s dp',
  (height) => {
    const c = clone(paymentCopy);
    c.home!.currencies = [{ currency: 'INR', owedMinor: 240000, oweMinor: 200000 }];
    delete c.groups!.goa;
    c.groups!.maple!.currencies[0].payments = [0, 1].map((i) => ({
      from: 'alex',
      to: i ? 'sam' : 'priya',
      fromName: 'Alex',
      toName: 'Ananthapadmanabhan',
      fromInitials: 'AR',
      toInitials: i ? 'AS' : 'AK',
      amountMinor: 100000,
    }));
    const v = overviewWidget(c, setup, { width: 172, height, pixelRatio: 2.625 }, auth, now, 2);
    expect(v.payments).not.toHaveLength(0);
    for (const row of v.payments) expect(row.textHeight).toBeLessThanOrEqual(row.contentHeight);
  },
);
it('keeps full-row initials readable at 200 percent on the maximum width', () => {
  const view = overviewWidget(
    paymentCopy,
    setup,
    { width: 640, height: 640, pixelRatio: 2.625 },
    auth,
    now,
    2,
  );
  expect(view.layout.compactPayments).toBe(false);
  expect(view.layout.paymentAvatarSize).toBeGreaterThanOrEqual(26);
});
it.each([1.3, 2])(
  'gives up the Payments heading, more link and Group captions before type at %s text',
  (scale) => {
    const v = overviewWidget(paymentCopy, setup, { width: 360, height: 344 }, auth, now, scale);
    expect(v.payments.length).toBeGreaterThan(0);
    expect(v.layout.paymentHeaderHeight).toBe(0);
    expect(v.paymentMore).toBeNull();
    for (const row of v.payments) {
      expect(row.inlineCaption).toBe('');
      expect(row.captionBelow).toBe(false);
    }
    expect(v.summary).toContain('in Maple House');
  },
);

it.each(['tall row', 'amount too wide'] as const)(
  'keeps both 130-percent footer actions when the payment has a %s',
  (reason) => {
    const c = clone(paymentCopy);
    c.groups!.maple!.currencies[0]!.payments[0]!.toName = 'Ananthapadmanabhan Balakrishnan';
    if (reason === 'amount too wide')
      c.groups!.maple!.currencies[0]!.payments[0]!.amountMinor = 99999999999999;
    const v = overviewWidget(
      c,
      setup,
      { width: 360, height: 280, pixelRatio: 2.625 },
      auth,
      now,
      1.3,
    );
    expect(v.review).toBe('To review\u00a0· 3');
    expect(v.action).toBe('＋ Add expense');
    expect(v.layout.sections.at(-1)?.id).toBe('footer');
    expect(v.layout.fits).toBe(true);
  },
);
it('keeps short incoming labels beside their amounts when the amount fits', () => {
  const c = clone(paymentCopy);
  c.groups = { maple: c.groups!.maple! };
  c.groups!.maple!.currencies = [
    {
      currency: 'INR',
      balanceMinor: 200000,
      payments: [
        { from: 'meera', to: 'alex', fromName: 'Meera', toName: 'Alex', amountMinor: 200000 },
      ],
    },
    {
      currency: 'EUR',
      balanceMinor: 4000,
      payments: [{ from: 'ravi', to: 'alex', fromName: 'Ravi', toName: 'Alex', amountMinor: 4000 }],
    },
  ];
  const v = overviewWidget(c, setup, { width: 172, height: 344 }, auth, now);
  expect(v.payments.map((row) => [row.label, row.amount, row.stack])).toEqual([
    ['From Meera', '₹2,000.00', false],
    ['From Ravi', '€40.00', false],
  ]);
});

it.each([
  [344, 1],
  [584, 2],
] as const)('fits %s dp with %s natural payment rows at 130 percent', (height, rows) => {
  const c = clone(paymentCopy);
  c.groups = { maple: c.groups!.maple! };
  c.groups.maple.currencies[0].payments = c.groups.maple.currencies[0].payments.slice(0, 2);
  const v = overviewWidget(c, setup, { width: 360, height, pixelRatio: 2.625 }, auth, now, 1.3);
  expect(v.review).toBe('To review\u00a0· 3');
  expect(v.action).toBe('＋ Add expense');
  expect(v.payments).toHaveLength(rows);
  expect(v.payments.map((p) => p.amount)).toEqual(
    rows === 1 ? ['₹500.00'] : ['₹500.00', '₹400.00'],
  );
});

it('uses all five natural rows when a 130-percent tall Overview has room', () => {
  const c = clone(paymentCopy);
  const v = overviewWidget(
    c,
    setup,
    { width: 360, height: 584, pixelRatio: 2.625 },
    auth,
    now,
    1.3,
  );
  expect(v.payments).toHaveLength(5);
  expect(v.layout.fits).toBe(true);
  expect(v.review).toBe('To review\u00a0· 3');
  expect(v.action).toBe('＋ Add expense');
});
