import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { groupWidget, type WidgetGroupPart } from './group-widget';
import type { WidgetSession } from './balances-widget';
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
    expect(view.layout.nameLines.join(' ')).toMatch(/^(Maple House|Group)$/);
    expect(view.layout.nameFontSize).toBeGreaterThanOrEqual(10);
    expect(view.layout.moneyFontSize).toBeGreaterThanOrEqual(10);
    expect(view.layout.sections.some((s) => s.id === 'action')).toBe(false);
  },
);

it('keeps the 130% avatar amounts on the right and the compact Add expense on one line', () => {
  const wide = groupWidget(part, setup, { width: 360, height: 344 }, auth, now, 1.3);
  expect(wide.layout.stackPayments).toBe(false);
  const small = groupWidget(part, setup, { width: 172, height: 224 }, auth, now, 1.3);
  expect(small.layout.actionLines).toEqual(['＋ Add expense']);
});

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
        pixels(l.padding) * 2;
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

it('uses Group at the true minimum when a longer valid name would crowd out the full balance', () => {
  const view = groupWidget(
    { ...part, name: 'Our family summer holiday in the mountains' },
    setup,
    { width: 110, height: 110 },
    auth,
    now,
    1.3,
  );
  expect(view.layout.fits).toBe(true);
  expect(view.layout.nameLines).toEqual(['Group']);
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
it('uses a tall real size for more payment rows and shares all leftover height among them', () => {
  const view = groupWidget(part, setup, { width: 372, height: 512 }, auth, now);
  expect(view.payments.length).toBeGreaterThan(4);
  expect(view.layout.sections.map(({ id }) => id)).toEqual(['header', 'payments', 'action']);
  expect(
    view.layout.sections.reduce((sum, s) => sum + s.height, 0) +
      view.layout.gap * 2 +
      view.layout.padding * 2,
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
      2 * l.padding;
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
        view.layout.padding * 2,
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
