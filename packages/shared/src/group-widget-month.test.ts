import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { groupWidget, type WidgetGroupPart, type WidgetMonthPart } from './group-widget';

const now = Date.parse('2026-11-13T04:11:00Z');
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup = { kind: 'group' as const, accountId: 'alex', groupId: 'maple', widgetId: 7 };
const group: WidgetGroupPart = {
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
      payments: Array.from({ length: 2 }, (_, index) => ({
        from: 'alex',
        to: `person${index}`,
        fromName: 'Alex',
        toName: 'Sam',
        amountMinor: 42000,
      })),
    },
  ],
};
const month: WidgetMonthPart = {
  month: '2026-11',
  verifiedAt: now - 180_000,
  count: 12,
  mainCurrency: 'INR',
  mainCurrencyOnly: false,
  totals: [{ currency: 'INR', totalMinor: 2354000 }],
  shareMinor: 785000,
};
beforeEach(() => vi.stubEnv('TZ', 'Asia/Kolkata'));
afterEach(() => vi.unstubAllEnvs());

it('shows the Month in its own currency columns with its own saved time', () => {
  const view = groupWidget(group, setup, { width: 360, height: 344 }, auth, now, 1, month);
  expect(view.month).toEqual({
    totals: ['₹23,540.00'],
    share: '₹7,850.00',
    mainCurrencyOnly: null,
    count: null,
    saved: 'Saved 9:38',
    prompt: null,
    more: null,
  });
  expect(view.saved).toBe('Saved 9:41');
  expect(view.layout.sections.map((section) => section.id)).toEqual([
    'header',
    'payments',
    'month',
    'action',
  ]);
  expect(view.layout.paymentLabel).toBe('PAYMENTS');
  expect(view.layout.monthLabel).toBe('THIS MONTH');
  expect(view.summary).toContain('This Month. Group spent. ₹23,540.00. Your share ₹7,850.00');
  const taller = groupWidget(group, setup, { width: 360, height: 584 }, auth, now, 1, month);
  expect(view.layout.sections.find((s) => s.id === 'month')?.height).toBe(
    taller.layout.sections.find((s) => s.id === 'month')?.height,
  );
});

it('keeps Main currency first, extra currencies separate and JPY in whole yen', () => {
  const multi = {
    ...month,
    mainCurrencyOnly: true,
    totals: [
      { currency: 'JPY', totalMinor: 42000 },
      ...month.totals,
      { currency: 'EUR', totalMinor: 32000 },
    ],
  };
  const view = groupWidget(group, setup, { width: 360, height: 344 }, auth, now, 1, multi);
  expect(view.month?.totals).toEqual(['₹23,540.00', '¥42,000', '€320.00']);
  expect(view.month?.share).toBe('₹7,850.00');
  expect(view.month?.mainCurrencyOnly).toBe('Main currency only');
  expect(view.summary).toContain('Main currency only');
  expect(view.layout.sections.some((s) => s.id === 'month')).toBe(true);
});

it.each([undefined, { ...month, month: '2026-10' }])(
  'offers the Group when no current Month was saved',
  (saved) => {
    const view = groupWidget(group, setup, { width: 360, height: 344 }, auth, now, 1, saved);
    expect(view.month).toMatchObject({
      totals: [],
      share: null,
      saved: null,
      prompt: 'Open the Group to update',
    });
    expect(view.target).toBe('group');
    expect(view.summary).not.toMatch(/23,540|7,850|9:38/);
  },
);

it('changes to the missing-Month prompt at local midnight on the first of the Month', () => {
  for (const [time, expected] of [
    ['2026-11-30T18:29:59Z', '₹7,850.00'],
    ['2026-11-30T18:30:00Z', null],
  ] as const) {
    const view = groupWidget(
      group,
      setup,
      { width: 360, height: 344 },
      auth,
      Date.parse(time),
      1,
      month,
    );
    expect(view.month?.share).toBe(expected);
  }
});

it('uses a count for Hide amounts, including in TalkBack, and omits a share absent from the read', () => {
  const hidden = groupWidget(
    group,
    { ...setup, hideAmounts: true },
    { width: 360, height: 344 },
    auth,
    now,
    1,
    month,
  );
  expect(hidden.month?.count).toBe('12\u00a0Expenses this Month');
  expect(JSON.stringify(hidden)).not.toMatch(/₹|23,540|7,850|Sam|person/);
  const withoutShare = { ...month };
  delete withoutShare.shareMinor;
  expect(
    groupWidget(group, setup, { width: 360, height: 344 }, auth, now, 1, withoutShare).month?.share,
  ).toBeNull();
});

it.each([1.3, 2])(
  'drops the Month block before shrinking type at %s text while keeping its spoken figures',
  (scale) => {
    const view = groupWidget(group, setup, { width: 360, height: 344 }, auth, now, scale, month);
    expect(view.layout.sections.some((s) => s.id === 'month')).toBe(false);
    expect(view.layout.paymentLabel).toBeNull();
    expect(view.layout.textFactor).toBe(1);
    expect(view.summary).toContain('₹23,540.00');
  },
);

it('keeps the 4×2 payments unlabelled and admits Month after both payments fit', () => {
  const short = groupWidget(group, setup, { width: 360, height: 224 }, auth, now, 1, month);
  expect(short.layout.paymentLabel).toBeNull();
  expect(short.layout.sections.some((s) => s.id === 'month')).toBe(false);
  const tall = groupWidget(group, setup, { width: 360, height: 344 }, auth, now, 1, month);
  expect(tall.layout.sections.some((s) => s.id === 'month')).toBe(true);
  expect(tall.payments).toHaveLength(group.currencies[0]!.payments.length);
});

it.each([
  { width: 110, height: 110 },
  { width: 172, height: 224 },
  { width: 172, height: 344 },
  { width: 225, height: 288 },
  { width: 266, height: 344 },
  { width: 360, height: 224 },
  { width: 360, height: 344 },
  { width: 360, height: 464 },
  { width: 360, height: 584 },
  { width: 640, height: 640 },
])('fits the Month layout across sizes and text scales at $width×$height', (size) => {
  for (const scale of [1, 1.3, 2]) {
    for (const selected of [setup, { ...setup, hideAmounts: true }]) {
      const view = groupWidget(
        group,
        selected,
        { ...size, pixelRatio: 2.625 },
        auth,
        now,
        scale,
        month,
      );
      expect(view.layout.fits).toBe(true);
      const used =
        view.layout.sections.reduce((sum, section) => sum + section.height, 0) +
        Math.max(0, view.layout.sections.length - 1) * view.layout.gap +
        view.layout.paddingVertical * 2;
      expect(used).toBeLessThanOrEqual(size.height + 0.001);
      expect(view.layout.sections.length).toBeGreaterThan(0);
      expect(view.name).toBe(group.name);
    }
  }
});

it('hides Month figures when signed out, expired, set up for another account or refused', () => {
  for (const session of [
    { status: 'signed-out' as const },
    { status: 'expired' as const },
    { ...auth, accountId: 'sam' },
  ])
    expect(
      groupWidget(group, setup, { width: 360, height: 584 }, session, now, 1, month).month,
    ).toBeNull();
  expect(
    groupWidget(null, setup, { width: 360, height: 584 }, auth, now, 1, month).month,
  ).toBeNull();
});

it('keeps other saved sections when the independent Month part is damaged', () => {
  const broken = JSON.parse('{"month":"2026-11","totals":null}');
  const view = groupWidget(group, setup, { width: 360, height: 344 }, auth, now, 1, broken);
  expect(view.name).toBe(group.name);
  expect(view.compactAmount).toBe('₹1,480.00');
  expect(view.month?.prompt).toBe('Open the Group to update');
});

it('continues to show a stored legacy currency separately', () => {
  const legacy = {
    ...month,
    mainCurrencyOnly: true,
    totals: [...month.totals, { currency: 'DEM', totalMinor: 12345 }],
  };
  expect(
    groupWidget(group, setup, { width: 360, height: 464 }, auth, now, 1, legacy).month?.totals,
  ).toEqual(['₹23,540.00', 'DEM 123.45']);
});

it('admits a partial Month after the payment rows at an in-between height', () => {
  const many = {
    ...month,
    mainCurrencyOnly: true,
    totals: [
      ...month.totals,
      { currency: 'EUR', totalMinor: 32000 },
      { currency: 'JPY', totalMinor: 42000 },
      { currency: 'USD', totalMinor: 50000 },
      { currency: 'GBP', totalMinor: 30000 },
    ],
  };
  const view = groupWidget(group, setup, { width: 360, height: 330 }, auth, now, 1, many);
  expect(view.layout.sections.some((s) => s.id === 'month')).toBe(true);
  expect(view.month?.totals.length).toBeGreaterThan(0);
  expect(view.month?.totals.length).toBeLessThan(5);
  expect(view.month?.more).toMatch(/^\+\d+\s+more$/);
  expect(view.payments).toHaveLength(2);
  expect(view.summary).toContain('£300.00');
});

it('uses currency words instead of a more hint when no Month amount row fits', () => {
  const many: WidgetMonthPart = {
    ...month,
    totals: Array.from({ length: 5 }, () => month.totals[0]!),
  };
  delete many.shareMinor;
  const view = groupWidget(group, setup, { width: 360, height: 310 }, auth, now, 1, many);
  expect(view.layout.sections.find((s) => s.id === 'month')?.rows).toBe(0);
  expect(view.month?.totals).toEqual([]);
  expect(view.month?.more).toBe('In 5\u00a0currencies');
});

it('uses the current phone zone for the Month even while Date retains its former offset', () => {
  const resolve = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolve.call(this), timeZone: 'Pacific/Honolulu' };
  });
  try {
    const instant = Date.parse('2026-11-01T00:30:00Z');
    expect(new Date(instant).getUTCMonth()).toBe(10);
    const view = groupWidget(group, setup, { width: 360, height: 344 }, auth, instant, 1, {
      ...month,
      month: '2026-10',
    });
    expect(view.month?.share).toBe('₹7,850.00');
  } finally {
    vi.restoreAllMocks();
  }
});

it('includes the Month panels padding in the measured section', () => {
  const view = groupWidget(group, setup, { width: 360, height: 464 }, auth, now, 1, month);
  expect(view.layout.monthPanelPadding).toBe(8);
  const measured = view.layout.sections.find((s) => s.id === 'month')!;
  expect(measured.height).toBeGreaterThanOrEqual(
    view.layout.sectionLabelHeight +
      16 +
      view.layout.fontSizes.secondary * 1.3 +
      4 +
      view.layout.monthAmountFontSize * 1.3,
  );
});

it.each([
  { width: 172, height: 344 },
  { width: 360, height: 270 },
])('preserves both payments before adding Month at $width×$height', (size) => {
  const view = groupWidget(group, setup, { ...size, pixelRatio: 2.625 }, auth, now, 1, month);
  expect(view.payments).toHaveLength(2);
  expect(view.layout.sections.some((s) => s.id === 'month')).toBe(false);
});
it('never trades a baseline payment row for a Month section', () => {
  const many = {
    ...group,
    currencies: [
      {
        ...group.currencies[0]!,
        payments: Array.from({ length: 12 }, () => group.currencies[0]!.payments[0]!),
      },
    ],
  };
  for (const width of [172, 360])
    for (const height of [224, 270, 344, 464, 584]) {
      const baseline = groupWidget(many, setup, { width, height }, auth, now, 1.3);
      const withMonth = groupWidget(many, setup, { width, height }, auth, now, 1.3, month);
      if (width === 172 && height === 584) expect(baseline.payments.length).toBeGreaterThan(0);
      expect(withMonth.payments).toHaveLength(baseline.payments.length);
    }
});
it('places the all-square balance sentence before the missing Month prompt', () => {
  const square = { ...group, currencies: [] };
  const view = groupWidget(square, setup, { width: 360, height: 344 }, auth, now);
  const ids = view.layout.sections.map((s) => s.id);
  expect(ids.indexOf('description')).toBeLessThan(ids.indexOf('month'));
});
