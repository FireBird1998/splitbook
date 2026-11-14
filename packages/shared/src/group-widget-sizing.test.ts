import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { groupWidget, type WidgetGroupPart } from './group-widget';
import type { WidgetSession } from './balances-widget';
import { widgetSavedTime } from './balances-widget';
import { widgetText } from './widget-sizing';
beforeAll(() => {
  vi.stubEnv('TZ', 'Asia/Kolkata');
});
afterAll(() => {
  vi.unstubAllEnvs();
});
const now = Date.parse('2026-11-13T04:11:00Z');
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup = { kind: 'group' as const, accountId: 'alex', groupId: 'maple', widgetId: 7 };
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
      payments: Array.from({ length: 12 }, (_, index) => ({
        from: 'alex',
        to: 'person' + index,
        fromName: 'Alex',
        toName: 'Sam',
        toInitials: 'SC',
        amountMinor: 1000,
      })),
    },
  ],
};
it('fits both board mini payments in the real 2×2 without a grey-panel inset or a more hint', () => {
  const copy = {
    ...part,
    currencies: [{ ...part.currencies[0]!, payments: part.currencies[0]!.payments.slice(0, 2) }],
  };
  const view = groupWidget(copy, setup, { width: 172, height: 224 }, auth, now);
  expect(view.payments).toHaveLength(2);
  expect(view.more).toBeNull();
  expect(view.layout.sections.find((s) => s.id === 'payments')!.rowHeight).toBeGreaterThanOrEqual(
    28,
  );
});

it('draws the shared overflow hint at 300 dp and 130% even when no payment row fits', () => {
  const view = groupWidget(part, setup, { width: 300, height: 200 }, auth, now, 1.3);
  expect(view.more).not.toBeNull();
  expect(view.layout.showMore).toBe(true);
  expect(view.layout.sections.find((s) => s.id === 'payments')?.more).toBe(
    12 - view.payments.length,
  );
});

it.each([1, 1.3, 2])(
  'keeps the full balance and a readable heading at the declared 110×110 minimum at %s',
  (scale) => {
    const view = groupWidget(part, setup, { width: 110, height: 110 }, auth, now, scale);
    expect(view.layout.fits).toBe(true);
    expect(view.compactAmount).toBe('₹1,480.00');
    expect(view.layout.nameLines.join(' ')).toBe('Maple House');
    expect(view.layout.nameFontSize).toBeGreaterThanOrEqual(10);
    expect(view.layout.moneyFontSize).toBeGreaterThanOrEqual(10);
    expect(view.layout.sections.some((s) => s.id === 'action')).toBe(false);
  },
);

it.each([266, 360])(
  'keeps 130% amounts on the right at %s dp and compact Add expense on one line',
  (width) => {
    const pair = {
      ...part,
      currencies: [
        {
          ...part.currencies[0]!,
          payments: [
            { ...part.currencies[0]!.payments[0]!, toName: 'Priya', amountMinor: 106000 },
            { ...part.currencies[0]!.payments[1]!, amountMinor: 42000 },
          ],
        },
      ],
    };
    const wide = groupWidget(pair, setup, { width, height: 344 }, auth, now, 1.3);
    expect(wide.layout.stackPayments).toBe(false);
    const small = groupWidget(part, setup, { width: 172, height: 224 }, auth, now, 1.3);
    expect(small.layout.actionLines).toEqual(['＋ Add expense']);
  },
);

it('measures each payment label and amount within a few-payment tall row, including 200% height growth', () => {
  const copy = {
    ...part,
    currencies: [{ ...part.currencies[0]!, payments: part.currencies[0]!.payments.slice(0, 2) }],
  };
  for (const scale of [1, 1.3, 2]) {
    const view = groupWidget(copy, setup, { width: 372, height: 640 }, auth, now, scale);
    const payments = view.layout.sections.find((s) => s.id === 'payments')!;
    expect(view.payments).toHaveLength(2);
    expect(payments.height).toBeGreaterThan(400);
    const text = widgetText(view.layout.width, scale, view.layout.textFactor);
    expect(text.line(13)).toBeLessThanOrEqual(payments.rowHeight);
    expect(payments.rowHeight).toBeGreaterThanOrEqual(28 * scale);
    expect(view.layout.sections.at(-1)?.height).toBeLessThan(65);
  }
});

it.each([1, 1.3, 2])(
  'budgets height as well as width at %s text on the native pixel grid',
  (scale) => {
    for (const size of [
      { width: 110, height: 110 },
      { width: 172, height: 224 },
      { width: 360, height: 584 },
    ]) {
      const view = groupWidget(part, setup, { ...size, pixelRatio: 2.625 }, auth, now, scale);
      const l = view.layout;
      const pixels = (dp: number) => Math.round(dp * 2.625);
      expect(l.fits).toBe(true);
      const used =
        l.sections.reduce((sum, section) => sum + pixels(section.height), 0) +
        Math.max(0, l.sections.length - 1) * pixels(l.gap) +
        pixels(l.paddingVertical) * 2;
      expect(used).toBeLessThanOrEqual(Math.floor(size.height * 2.625));
      const row = l.paymentRows[0];
      if (row) expect(row.height).toBeGreaterThanOrEqual(28 * scale * l.textFactor);
      const header = l.sections.find((s) => s.id === 'header')!;
      expect(header.rowHeight).toBeGreaterThanOrEqual(
        l.nameLines.length * widgetText(l.width, scale, 1, 2.625).line(l.nameFontSize),
      );
    }
  },
);

it('keeps the archived separator with final rather than dangling after owe', () => {
  const view = groupWidget(
    { ...part, archived: true },
    setup,
    { width: 172, height: 224 },
    auth,
    now,
    2,
  );
  expect(view.layout.balanceLabelLines.join(' ')).toBe('You owe · final');
  expect(view.layout.balanceLabelLines.every((line) => !line.endsWith('·'))).toBe(true);
});

it('keeps a long Group name for single-line ellipsis at the true minimum', () => {
  const view = groupWidget(
    { ...part, name: 'Our family summer holiday in the mountains' },
    setup,
    { width: 110, height: 110 },
    auth,
    now,
    1.3,
  );
  expect(view.layout.fits).toBe(true);
  expect(view.layout.nameLines).toEqual(['Our family summer holiday in the mountains']);
  expect(view.compactAmount).toBe('₹1,480.00');
});

it('removes the optional tile before shrinking a name that fits without it', () => {
  const view = groupWidget(
    { ...part, name: 'MountainAdventureClub' },
    setup,
    { width: 240, height: 640 },
    auth,
    now,
    1.3,
  );
  expect(view.layout.nameFontSize).toBe(13);
  expect(view.layout.showTile).toBe(false);
});

it.each([1, 1.3, 2])(
  'keeps the true minimum text rectangle clear of its rounded corners at %s',
  (scale) => {
    const view = groupWidget(
      part,
      setup,
      { width: 110, height: 110, pixelRatio: 2.625 },
      auth,
      now,
      scale,
    );
    const l = view.layout;
    const bottom = l.paddingVertical;
    const radius = l.cornerRadius;
    const inset = radius - Math.sqrt(radius ** 2 - Math.max(0, radius - bottom) ** 2);
    expect(l.padding).toBeGreaterThanOrEqual(inset);
    expect(
      widgetText(l.width, scale).width(view.compactAmount!, l.moneyFontSize, true),
    ).toBeLessThanOrEqual(l.width + 0.00001);
  },
);

it.each([161, 224, 640])(
  'keeps narrow full amounts when height grows past the minimum to %s dp',
  (height) => {
    const view = groupWidget(part, setup, { width: 110, height, pixelRatio: 2.625 }, auth, now, 2);
    expect(view.layout.fits).toBe(true);
    expect(
      widgetText(view.layout.width, 2).width(view.compactAmount!, view.layout.moneyFontSize, true),
    ).toBeLessThanOrEqual(view.layout.width + 0.00001);
  },
);

it('wraps a tall narrow overflow hint into complete words inside its measured height', () => {
  const view = groupWidget(part, setup, { width: 110, height: 640 }, auth, now, 2);
  expect(view.more).not.toBeNull();
  expect(view.layout.moreLines?.length).toBeGreaterThan(1);
  for (const line of view.layout.moreLines ?? [])
    expect(
      widgetText(view.layout.width, 2).width(line, view.layout.fontSizes.small),
    ).toBeLessThanOrEqual(view.layout.width);
});

it('keeps an unbroken Group name for single-line ellipsis at the readable floor', () => {
  const view = groupWidget(
    { ...part, name: 'MountainAdventureClub' },
    setup,
    { width: 110, height: 640 },
    auth,
    now,
    2,
  );
  expect(view.layout.nameLines).toEqual(['MountainAdventureClub']);
  expect(view.layout.nameFontSize).toBeGreaterThanOrEqual(10);
});
it('uses a tall real size for more payment rows and shares all leftover height among them', () => {
  const view = groupWidget(part, setup, { width: 372, height: 512 }, auth, now);
  expect(view.payments.length).toBeGreaterThan(4);
  expect(view.layout.sections.map(({ id }) => id)).toEqual(['header', 'payments', 'action']);
  expect(
    view.layout.sections.reduce((sum, s) => sum + s.height, 0) +
      view.layout.gap * 2 +
      view.layout.paddingVertical * 2,
  ).toBe(512);
});

const dimensions = [
  { width: 182, height: 200 },
  { width: 182, height: 304 },
  { width: 372, height: 200 },
  { width: 372, height: 304 },
  { width: 372, height: 408 },
  { width: 372, height: 512 },
  { width: 231, height: 257 },
  { width: 301, height: 353 },
  { width: 640, height: 640 },
  { width: 110, height: 110 },
];
it.each(dimensions.flatMap((size) => [1, 1.3, 2].map((scale) => ({ ...size, scale }))))(
  'fills $width×$height dp at $scale text without overflowing a returned row',
  ({ width, height, scale }) => {
    const view = groupWidget(part, setup, { width, height }, auth, now, scale);
    const l = view.layout;
    const used =
      l.sections.reduce((sum, section) => {
        expect(section.height).toBeGreaterThanOrEqual(section.rowHeight * section.rows - 0.001);
        expect(section.rows > 0 || section.more > 0).toBe(true);
        return sum + section.height;
      }, 0) +
      Math.max(0, l.sections.length - 1) * l.gap +
      2 * l.paddingVertical;
    expect(used).toBeCloseTo(height, 5);
    expect(view.payments).toHaveLength(l.paymentLines);
    expect(l.sections.find((section) => section.id === 'payments')?.rows ?? 0).toBe(
      view.payments.length,
    );
    const text = widgetText(l.width, scale);
    const paymentTextHeight = l.stackPayments
      ? text.line(l.paymentFontSize) + text.line(13) + 2
      : Math.max(text.line(l.paymentFontSize), text.line(13));
    for (const row of l.paymentRows)
      expect(row.contentHeight).toBeGreaterThanOrEqual(paymentTextHeight);
    for (const line of l.actionLines)
      expect(
        widgetText(l.width, scale).width(line, l.actionFontSize) + l.actionPaddingHorizontal * 2,
      ).toBeLessThanOrEqual(l.width + 0.001);
    expect(view.name).toBe('Maple House');
    expect(view.balance).toBe('You owe ₹1,480.00');
    if (l.actionLines.length) expect(l.sections.at(-1)?.id).toBe('action');
    else expect(l.sections.some((s) => s.id === 'action')).toBe(false);
    expect(view.summary.indexOf('Maple House')).toBeLessThan(view.summary.indexOf('You owe'));
    expect(view.summary.indexOf('You owe')).toBeLessThan(view.summary.indexOf('You pay'));
    expect(view.summary.indexOf('You pay')).toBeLessThan(view.summary.indexOf('Saved 9:41'));
    expect(view.summary.match(/You pay Sam/g)).toHaveLength(12);
  },
);
it.each([
  [{ width: 182, height: 200 }, 0],
  [{ width: 372, height: 200 }, 2],
  [{ width: 372, height: 304 }, 4],
] as const)('keeps the former 100% content at %j', (size, rows) => {
  const view = groupWidget(part, setup, size, auth, now);
  expect(view.payments).toHaveLength(rows);
  expect(view.addExpense).toBe(true);
  if (rows) expect(view.more).toBe(`+${12 - rows}\u00a0more\u00a0· ₹`);
  else expect(view.people).toBe('to 12\u00a0people');
});

const states: [
  string,
  WidgetGroupPart | null | undefined,
  typeof setup & { hideAmounts?: boolean },
  WidgetSession,
  number,
][] = [
  ['normal', part, setup, auth, now],
  ['all-square', { ...part, currencies: [] }, setup, auth, now],
  ['archived', { ...part, archived: true }, setup, auth, now],
  ['lost-access', null, setup, auth, now],
  ['no-copy', undefined, setup, auth, now],
  ['loading', undefined, setup, { ...auth, loading: true }, now],
  ['other-account', part, setup, { ...auth, accountId: 'sam' }, now],
  ['signed-out', part, setup, { status: 'signed-out' as const }, now],
  ['expired', part, setup, { status: 'expired' as const }, now],
  ['normal', part, { ...setup, hideAmounts: true }, auth, now],
  ['normal', part, setup, auth, now + 86400001],
  [
    'normal',
    {
      ...part,
      currencies: [...part.currencies, { currency: 'JPY', balanceMinor: 2500, payments: [] }],
    },
    setup,
    auth,
    now,
  ],
];
it.each(
  states.flatMap(([state, copy, setup, session, time], index) =>
    [dimensions.at(-1)!, dimensions[5]!].flatMap((size) =>
      [1, 1.3, 2].map((scale) => ({ state, copy, setup, session, time, size, scale, index })),
    ),
  ),
)(
  'fits state $state ($index) at $size and $scale text',
  ({ state, copy, setup, session, time, size, scale }) => {
    const view = groupWidget(copy, setup, size, session, time, scale);
    expect(view.state).toBe(state);
    expect(
      view.layout.sections.reduce((sum, section) => sum + section.height, 0) +
        Math.max(0, view.layout.sections.length - 1) * view.layout.gap +
        view.layout.paddingVertical * 2,
    ).toBeCloseTo(size.height, 5);
    if ('hideAmounts' in setup && setup.hideAmounts)
      expect(JSON.stringify(view)).not.toMatch(/₹|1,480|Sam|SC/);
    if (['lost-access', 'other-account', 'signed-out', 'expired'].includes(state))
      expect(JSON.stringify(view)).not.toMatch(/Maple House|₹|Sam/);
  },
);

it('keeps whole words and the complete amount in the smallest large-text state', () => {
  const expired = groupWidget(part, setup, dimensions[0]!, { status: 'expired' }, now, 2);
  expect(expired.layout.titleLines).toEqual(['Sign in again']);
  const normal = groupWidget(part, setup, dimensions[0]!, auth, now, 2);
  expect(normal.compactAmount).toBe('₹1,480.00');
  expect(normal.layout.balanceLabelLines).toEqual(['You owe']);
  expect(normal.layout.actionLines).toEqual(['Add expense']);
});

it('reserves the 32 dp icon when a compact large-text header omits its saved line', () => {
  const view = groupWidget(part, setup, dimensions[0]!, auth, now, 1.3);
  expect(view.layout.showTile).toBe(true);
  expect(
    view.layout.sections.find((section) => section.id === 'header')?.height,
  ).toBeGreaterThanOrEqual(32);
});

it('keeps the compact Group name on whole-word lines at 200% on the launcher minimum', () => {
  const view = groupWidget(part, setup, { width: 172, height: 224 }, auth, now, 2);
  expect(view.layout.nameLines.join(' ')).toBe('Maple House');
  for (const line of view.layout.nameLines)
    expect(line.length * view.layout.nameFontSize * 2 * 0.62).toBeLessThanOrEqual(
      view.layout.width + 0.001,
    );
  const header = view.layout.sections.find((section) => section.id === 'header')!;
  expect(header.height).toBeGreaterThanOrEqual(
    view.layout.nameLines.length * Math.ceil(view.layout.nameFontSize * 2 * 1.3),
  );
});

it('grows the first content row instead of a fixed footer when payments cannot fit', () => {
  const large: WidgetGroupPart = {
    ...part,
    currencies: [
      {
        ...part.currencies[0]!,
        payments: part.currencies[0]!.payments.map((p) => ({ ...p, amountMinor: 123456789012345 })),
      },
    ],
  };
  const view = groupWidget(large, setup, { width: 172, height: 584 }, auth, now, 2);
  expect(view.payments).toHaveLength(0);
  const action = view.layout.sections.find((section) => section.id === 'action')!;
  expect(action.height).toBe(action.rowHeight);
  const header = view.layout.sections.find((section) => section.id === 'header')!;
  expect(header.height).toBeGreaterThan(584 / 2);
});

it.each([1.3, 2])(
  'budgets the archived tag below the Group name at %s text on the minimum size',
  (scale) => {
    const view = groupWidget(
      { ...part, archived: true },
      setup,
      { width: 172, height: 224 },
      auth,
      now,
      scale,
    );
    const l = view.layout;
    expect(l.stackHeader).toBe(true);
    expect(l.nameLines.join(' ')).toBe('Maple House');
    for (const text of l.nameLines)
      expect(widgetText(l.width, scale).width(text, l.nameFontSize)).toBeLessThanOrEqual(
        l.width - (l.showTile ? 40 : 0) + 0.001,
      );
    const header = l.sections.find((section) => section.id === 'header')!;
    expect(header.height).toBeGreaterThanOrEqual(
      l.nameLines.length * Math.ceil(l.nameFontSize * scale * 1.3) +
        Math.ceil(9 * l.textFactor * scale * 1.3) +
        12,
    );
    expect(view.addExpense).toBe(false);
    expect(l.balanceLabelLines.join(' ')).toContain('final');
  },
);

it.each(states.filter(([, , s, ,], i) => [1, 3, 4, 6, 7, 8].includes(i) || s.hideAmounts))(
  'keeps message-state content together above spare height: %s',
  (_state, copy, setup, session, time) => {
    const short = groupWidget(copy, setup, { width: 360, height: 224 }, session, time);
    const tall = groupWidget(copy, setup, { width: 360, height: 584 }, session, time);
    for (const id of ['header', 'balance', 'title', 'description', 'hidden']) {
      const block = tall.layout.sections.find((s) => s.id === id);
      if (!block) continue;
      expect(block.height).toBe(block.rowHeight);
      expect(block.height).toBe(short.layout.sections.find((s) => s.id === id)?.height);
    }
    expect(tall.layout.sections.find((s) => s.id === 'space')!.height).toBeGreaterThan(300);
    const action = tall.layout.sections.find((s) => s.id === 'action');
    if (action) {
      expect(tall.layout.sections.at(-1)?.id).toBe('action');
      expect(action.height).toBe(action.rowHeight);
    }
  },
);

it.each([1.3, 2])('shows people rather than more with no payment rows at %s text', (scale) => {
  const pair = {
    ...part,
    currencies: [{ ...part.currencies[0]!, payments: part.currencies[0]!.payments.slice(0, 2) }],
  };
  const view = groupWidget(pair, setup, { width: 172, height: 224 }, auth, now, scale);
  expect(view.payments).toHaveLength(0);
  expect(view.more ?? '').not.toMatch(/more/);
  expect(view.layout.actionLines.join(' ')).toContain('Add expense');
  if (scale === 1.3) expect(view.more).toBe('to 2\u00a0people');
  if (scale === 2) expect(view.more).toBeNull();
});

it('uses people without a payment row on a narrow tall widget', () => {
  const view = groupWidget(part, setup, { width: 110, height: 224 }, auth, now, 2);
  expect(view.payments).toHaveLength(0);
  expect(view.more).toBe('to 12\u00a0people');
});

it.each([
  ['2026-11-07T18:29:59Z', null],
  ['2026-11-07T18:30:00Z', 'Day 1 of 3'],
  ['2026-11-08T18:30:00Z', 'Day 2 of 3'],
  ['2026-11-09T18:30:00Z', 'Day 3 of 3'],
  ['2026-11-10T18:30:00Z', null],
])('uses the phone calendar day in Asia/Kolkata at %s', (instant, day) => {
  const copy = {
    ...part,
    theme: 'trip' as const,
    tripDates: { start: '2026-11-08', end: '2026-11-10' },
  };
  const time = Date.parse(instant);
  const view = groupWidget(copy, setup, { width: 360, height: 224 }, auth, time);
  expect(view.tripDay).toBe(day);
  expect(view.layout.tripDay).toBe(day);
  if (day) expect(view.summary).toContain(day);
  else expect(view.summary).not.toContain('Day ');
});

it('keeps the Group name and omits the optional Trip badge at large text and compact widths', () => {
  const copy = {
    ...part,
    theme: 'trip' as const,
    name: 'Goa Friends Trip',
    tripDates: { start: '2026-11-13', end: '2026-11-15' },
  };
  for (const scale of [1.3, 2]) {
    const view = groupWidget(copy, setup, { width: 360, height: 344 }, auth, now, scale);
    expect(view.layout.tripDay).toBeNull();
    expect(view.layout.nameLines.join(' ')).toBe(copy.name);
    expect(view.summary).toContain('Day 1 of 3');
    expect(view.layout.textFactor).toBe(1);
  }
  expect(
    groupWidget(copy, setup, { width: 172, height: 224 }, auth, now).layout.tripDay,
  ).toBeNull();
});

it('omits Trip day for other Themes, older copies, incomplete and invalid dates', () => {
  for (const copy of [
    part,
    { ...part, tripDates: { start: '2026-11-13', end: '2026-11-15' } },
    { ...part, theme: 'trip' as const, tripDates: { start: '2026-11-13', end: null } },
    { ...part, theme: 'trip' as const, tripDates: { start: '2026-11-00', end: '2026-11-15' } },
  ]) {
    const view = groupWidget(copy, setup, { width: 360, height: 224 }, auth, now);
    expect(view.tripDay).toBeNull();
    expect(view.name).toBe(part.name);
  }
});

it('uses the newly reported phone zone while Date keeps its former local day', () => {
  const resolve = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolve.call(this), timeZone: 'Pacific/Honolulu' };
  });
  const instant = Date.parse('2026-11-01T00:30:00Z');
  const copy = {
    ...part,
    theme: 'trip' as const,
    tripDates: { start: '2026-10-31', end: '2026-11-02' },
  };
  expect(new Date(instant).getDate()).toBe(1);
  expect(groupWidget(copy, setup, { width: 360, height: 224 }, auth, instant).tripDay).toBe(
    'Day 1 of 3',
  );
  vi.restoreAllMocks();
});

it('reserves the Trip capsule padding above the balance and bounds long names', () => {
  const copy = {
    ...part,
    theme: 'trip' as const,
    tripDates: { start: '2026-11-13', end: '2026-11-15' },
  };
  const view = groupWidget(copy, setup, { width: 360, height: 224 }, auth, now);
  const text = widgetText(332);
  expect(view.layout.sections.find((s) => s.id === 'header')!.height).toBeGreaterThanOrEqual(
    text.line(11) * 2 + 9,
  );
  const long = groupWidget(
    { ...copy, name: 'Goa Friends Trip with a very long Group name' },
    setup,
    { width: 172, height: 224 },
    auth,
    now,
    2,
  );
  expect(long.layout.nameLines).toHaveLength(2);
  expect(long.summary).toContain('Goa Friends Trip with a very long Group name');
  expect(long.layout.fits).toBe(true);
});

it('uses the fresh phone zone for the saved clock and weekday', () => {
  const resolve = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolve.call(this), timeZone: 'Pacific/Honolulu' };
  });
  const saved = Date.parse('2026-11-14T02:04:00Z');
  expect(widgetSavedTime(saved, Date.parse('2026-11-14T04:30:00Z'))).toBe('Saved 4:04');
  expect(widgetSavedTime(saved, Date.parse('2026-11-14T10:30:00Z'))).toBe('Saved Fri');
  vi.restoreAllMocks();
});

it('fits both incoming mini payments on one line at the real launcher 2×2 size', () => {
  const incoming = {
    ...part,
    currencies: [
      {
        currency: 'INR',
        balanceMinor: 240000,
        payments: [
          { from: 'meera', to: 'alex', fromName: 'Meera', toName: 'Alex', amountMinor: 145000 },
          { from: 'rohan', to: 'alex', fromName: 'Rohan', toName: 'Alex', amountMinor: 95000 },
        ],
      },
    ],
  };
  const view = groupWidget(
    incoming,
    setup,
    { width: 172, height: 224, pixelRatio: 2.625 },
    auth,
    now,
  );
  expect(view.payments.map((p) => p.displayLabel)).toEqual(['From Meera', 'From Rohan']);
  expect(view.layout.stackPayments).toBe(false);
  expect(view.more).toBeNull();
  expect(view.summary).toContain('Meera pays you');
});
