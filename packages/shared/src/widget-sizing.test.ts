import { expect, it } from 'vitest';
import { fitWidgetLayout, fitWidgetSections, widgetText } from './widget-sizing';

it('honours a readable-row cap, including a hint alone when no full amount fits the width', () => {
  for (const cap of [0, 2]) {
    const result = fitWidgetSections(400, [{ id: 'payments', rows: 8, maxRows: cap, rowHeight: 28, moreHeight: 16 }]);
    expect(result.sections.map((s) => [s.rows, s.more])).toEqual([[cap, 8 - cap]]);
  }
});

it('admits an optional older-copy prompt only after its list fits completely', () => {
  const sections = [
    { id: 'payments', rows: 2, rowHeight: 30, moreHeight: 12 },
    { id: 'update', rows: 1, rowHeight: 20, whenComplete: 'payments' },
  ];
  expect(fitWidgetSections(75, sections, 4).sections.map((s) => s.id)).toEqual(['payments']);
  expect(fitWidgetSections(90, sections, 4).sections.map((s) => s.id)).toEqual(['payments', 'update']);
});

it('measures proportional button text, mono amounts and whole words through the same interface', () => {
  const text = widgetText(144, 1.3);
  expect(text.words('＋ Add expense', 12, 120)).toEqual(['＋ Add expense']);
  expect(text.width('₹1,480.00', 13, true)).toBeCloseTo(91.26, 2);
  expect(widgetText(105, 2).words('You owe · final', 11)).toEqual(['You owe', '· final']);
});

it('removes optional content before shrinking text, and reports overflow at the readable floor', () => {
  const make = (text: ReturnType<typeof widgetText>, optional: boolean) => ({
    optional,
    sections: [{ id: 'name', rows: 1, rowHeight: text.line(13), required: true },
      ...(optional ? [{ id: 'action', rows: 1, rowHeight: 30, required: true }] : [])],
  });
  const normal = fitWidgetLayout({ width: 120, height: 20 }, 1, make);
  expect(normal.optional).toBe(false);
  expect(normal.textFactor).toBe(1);
  const tiny = fitWidgetLayout({ width: 120, height: 5 }, 1, make);
  expect(tiny.textFactor).toBe(0.8);
  expect(tiny.fits).toBe(false);
  expect(tiny.overflow).toBe(9);
});

it('normalises invalid counts and dimensions without NaN, negative rows or endless growth', () => {
  const result = fitWidgetSections(NaN, [
    { id: 'ignored', rows: -1, rowHeight: NaN },
    { id: 'required', rows: 1.9, rowHeight: 12.2, required: true },
  ], -8);
  expect(result.fits).toBe(false);
  expect(result.overflow).toBe(13);
  expect(result.sections.map((s) => [s.id, s.rows, s.height])).toEqual([['required', 1, 13]]);
  expect(fitWidgetSections(-1, []).sections).toEqual([]);
});

it('rounds fractional dp on a physical pixel grid without allocating past the available pixels', () => {
  const result = fitWidgetSections(100.2, [
    { id: 'payments', rows: 3, rowHeight: 10.1, grow: true },
    { id: 'action', rows: 1, rowHeight: 19.1, required: true },
  ], 3.1, 2.625);
  const pixels = (dp: number) => Math.round(dp * 2.625);
  expect(result.sections.map((s) => s.rows)).toEqual([3, 1]);
  expect(result.sections.reduce((sum, s) => sum + pixels(s.height), pixels(result.gap))).toBe(263);
  for (const s of result.sections) {
    expect(s.height * 2.625).toBeCloseTo(pixels(s.height), 8);
    expect(s.rowHeight * 2.625).toBeCloseTo(pixels(s.rowHeight), 8);
  }
});

it('admits all rows when they cost less than one row and the overflow hint', () => {
  const result = fitWidgetSections(40, [
    { id: 'payments', rows: 2, rowHeight: 20, moreHeight: 50 },
  ]);
  expect(result.sections.map((s) => [s.rows, s.more, s.height])).toEqual([[2, 0, 40]]);
});

it('owns a visible overflow hint even when no payment row fits', () => {
  const result = fitWidgetSections(40, [
    { id: 'balance', rows: 1, rowHeight: 20, required: true },
    { id: 'payments', rows: 2, rowHeight: 30, moreHeight: 12 },
  ], 4);
  expect(result.sections.map((s) => [s.id, s.rows, s.more])).toEqual([
    ['balance', 1, 0], ['payments', 0, 2],
  ]);
});

it('adds rows in rounds so both already-admitted lists grow', () => {
  const result = fitWidgetSections(160, [
    { id: 'payments', rows: 12, rowHeight: 30, grow: true },
    { id: 'groups', rows: 8, rowHeight: 30, grow: true },
  ], 0);
  expect(result.sections.map((s) => [s.id, s.rows])).toEqual([
    ['payments', 3], ['groups', 2],
  ]);
});

it('uses the first content row for spare height when no section asks to grow, not the footer', () => {
  const result = fitWidgetSections(200, [
    { id: 'balance', rows: 1, rowHeight: 40, required: true },
    { id: 'action', rows: 1, rowHeight: 32, required: true },
  ]);
  expect(result.sections.map((s) => [s.id, s.height, s.rowHeight])).toEqual([
    ['balance', 160, 160], ['action', 32, 32],
  ]);
});

it('reports the required overflow instead of claiming that a below-minimum layout fits', () => {
  const result = fitWidgetSections(60, [
    { id: 'name', rows: 1, rowHeight: 24, required: true },
    { id: 'balance', rows: 1, rowHeight: 40, required: true },
  ]);
  expect(result.fits).toBe(false);
  expect(result.overflow).toBe(12);
  expect(result.sections.map((s) => s.id)).toEqual(['name', 'balance']);
});

it('admits sections in priority order before filling their rows, reserving required content', () => {
  const sections = [
    { id: 'balance', rows: 1, rowHeight: 40, required: true },
    { id: 'payments', rows: 6, rowHeight: 32, moreHeight: 16, grow: true },
    { id: 'groups', rows: 4, rowHeight: 24, moreHeight: 16, grow: true },
    { id: 'action', rows: 1, rowHeight: 32, required: true },
  ];
  const view = fitWidgetSections(200, sections, 8);
  expect(view.sections.map(({ id, rows, more }) => ({ id, rows, more }))).toEqual([
    { id: 'balance', rows: 1, more: 0 },
    { id: 'payments', rows: 1, more: 5 },
    { id: 'groups', rows: 1, more: 3 },
    { id: 'action', rows: 1, more: 0 },
  ]);
  expect(view.sections.reduce((sum, s) => sum + s.height, 0) + view.gap * 3).toBe(200);
});

it('does not skip an earlier section to admit a cheaper later section', () => {
  const result = fitWidgetSections(120, [
    { id: 'balance', rows: 1, rowHeight: 40, required: true },
    { id: 'payments', rows: 3, rowHeight: 80, moreHeight: 16, grow: true },
    { id: 'groups', rows: 3, rowHeight: 20, moreHeight: 12, grow: true },
    { id: 'action', rows: 1, rowHeight: 32, required: true },
  ]);
  expect(result.sections.map((s) => [s.id, s.rows, s.more])).toEqual([
    ['balance', 1, 0], ['payments', 0, 3], ['action', 1, 0],
  ]);
});
