import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { groupWidget, type WidgetGroupPart } from './group-widget';
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
];
it.each(dimensions.flatMap((size) => [1, 1.3, 2].map((scale) => ({ ...size, scale }))))(
  'fills $width×$height dp at $scale text without overflowing a returned row',
  ({ width, height, scale }) => {
    const view = groupWidget(part, setup, { width, height }, auth, now, scale);
    const l = view.layout;
    const used =
      l.sections.reduce((sum, section) => {
        expect(section.height).toBeGreaterThanOrEqual(section.rowHeight * section.rows - 0.001);
        expect(section.rows).toBeGreaterThan(0);
        return sum + section.height;
      }, 0) +
      Math.max(0, l.sections.length - 1) * l.gap +
      2 * l.padding;
    expect(used).toBeCloseTo(height, 5);
    expect(view.payments).toHaveLength(l.paymentLines);
    expect(view.name).toBe('Maple House');
    expect(view.balance).toBe('You owe ₹1,480.00');
    expect(l.sections.at(-1)?.id).toBe('action');
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

const states = [
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
] as const;
it.each(
  states.flatMap(([state, copy, setup, session, time], index) =>
    [dimensions[0]!, dimensions[5]!].flatMap((size) =>
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
  expect(expired.layout.titleLines).toEqual(['Sign in', 'again']);
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
