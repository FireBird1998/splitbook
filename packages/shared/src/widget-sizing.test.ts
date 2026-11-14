import { expect, it } from 'vitest';
import { fitWidgetLayout, fitWidgetSections, widgetText } from './widget-sizing';

it('honours a readable-row cap, including a hint alone when no full amount fits the width', () => {
  for (const cap of [0, 2]) {
    const result = fitWidgetSections(400, [
      { id: 'payments', rows: 8, maxRows: cap, rowHeight: 28, moreHeight: 16 },
    ]);
    expect(result.sections.map((s) => [s.rows, s.more])).toEqual([[cap, 8 - cap]]);
  }
});

it('admits an optional older-copy prompt only after its list fits completely', () => {
  const sections = [
    { id: 'payments', rows: 2, rowHeight: 30, moreHeight: 12 },
    { id: 'update', rows: 1, rowHeight: 20, whenComplete: 'payments' },
  ];
  expect(fitWidgetSections(75, sections, 4).sections.map((s) => s.id)).toEqual(['payments']);
  expect(fitWidgetSections(90, sections, 4).sections.map((s) => s.id)).toEqual([
    'payments',
    'update',
  ]);
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
    sections: [
      { id: 'name', rows: 1, rowHeight: text.line(13), required: true },
      ...(optional ? [{ id: 'action', rows: 1, rowHeight: 30, required: true }] : []),
    ],
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
  const result = fitWidgetSections(
    NaN,
    [
      { id: 'ignored', rows: -1, rowHeight: NaN },
      { id: 'required', rows: 1.9, rowHeight: 12.2, required: true },
    ],
    -8,
  );
  expect(result.fits).toBe(false);
  expect(result.overflow).toBe(13);
  expect(result.sections.map((s) => [s.id, s.rows, s.height])).toEqual([['required', 1, 13]]);
  expect(fitWidgetSections(-1, []).sections).toEqual([]);
});

it('rounds fractional dp on a physical pixel grid without allocating past the available pixels', () => {
  const result = fitWidgetSections(
    100.2,
    [
      { id: 'payments', rows: 3, rowHeight: 10.1, grow: true },
      { id: 'action', rows: 1, rowHeight: 19.1, required: true },
    ],
    3.1,
    2.625,
  );
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
  const result = fitWidgetSections(
    40,
    [
      { id: 'balance', rows: 1, rowHeight: 20, required: true },
      { id: 'payments', rows: 2, rowHeight: 30, moreHeight: 12 },
    ],
    4,
  );
  expect(result.sections.map((s) => [s.id, s.rows, s.more])).toEqual([
    ['balance', 1, 0],
    ['payments', 0, 2],
  ]);
});

it('adds rows in rounds so both already-admitted lists grow', () => {
  const result = fitWidgetSections(
    160,
    [
      { id: 'payments', rows: 12, rowHeight: 30, grow: true },
      { id: 'groups', rows: 8, rowHeight: 30, grow: true },
    ],
    0,
  );
  expect(result.sections.map((s) => [s.id, s.rows])).toEqual([
    ['payments', 3],
    ['groups', 2],
  ]);
});

it('uses the first content row for spare height when no section asks to grow, not the footer', () => {
  const result = fitWidgetSections(200, [
    { id: 'balance', rows: 1, rowHeight: 40, required: true },
    { id: 'action', rows: 1, rowHeight: 32, required: true },
  ]);
  expect(result.sections.map((s) => [s.id, s.height, s.rowHeight])).toEqual([
    ['balance', 160, 160],
    ['action', 32, 32],
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
    ['balance', 1, 0],
    ['payments', 0, 3],
    ['action', 1, 0],
  ]);
});

it('reserves a fixed column beside a variable list while adding list rows in rounds', () => {
  const result = fitWidgetSections(
    138,
    [
      { id: 'payments', rows: 2, rowHeight: 30, moreHeight: 12, grow: true },
      { id: 'month', rows: 6, rowHeight: 20, inset: 20, minHeight: 80, moreHeight: 12 },
    ],
    4,
  );
  expect(result.sections.map((s) => [s.id, s.rows, s.more])).toEqual([
    ['payments', 1, 1],
    ['month', 3, 3],
  ]);
  expect(result.sections[1]?.height).toBe(92);
  expect(result.fits).toBe(true);
});

it('rounds a minimum section height to physical pixels and reports a required floor that cannot fit', () => {
  const result = fitWidgetSections(
    30,
    [{ id: 'month', rows: 1, rowHeight: 10, minHeight: 40.1, required: true }],
    0,
    2,
  );
  expect(result.fits).toBe(false);
  expect(result.sections[0]?.height).toBe(40.5);
  expect(result.overflow).toBe(10.5);
});

it('admits a later section after the first three rows of an earlier list, before more rows', () => {
  const sections = [
    { id: 'payments', rows: 2, rowHeight: 10 },
    { id: 'recent', rows: 8, rowHeight: 10 },
    { id: 'month', rows: 1, rowHeight: 20, afterRows: { id: 'recent', rows: 3 } },
  ];
  const short = fitWidgetSections(65, sections, 0);
  expect(short.sections.map(({ id, rows }) => ({ id, rows }))).toEqual([
    { id: 'payments', rows: 2 },
    { id: 'recent', rows: 4 },
  ]);
  const tall = fitWidgetSections(80, sections, 0);
  expect(tall.sections.map(({ id, rows }) => ({ id, rows }))).toEqual([
    { id: 'payments', rows: 2 },
    { id: 'recent', rows: 4 },
    { id: 'month', rows: 1 },
  ]);
  expect(tall.fits).toBe(true);
});

it('admits the next section after a complete Recent list shorter than its threshold', () => {
  const fit = fitWidgetSections(
    60,
    [
      { id: 'payments', rows: 2, rowHeight: 10 },
      { id: 'recent', rows: 2, rowHeight: 10 },
      { id: 'month', rows: 1, rowHeight: 20, afterRows: { id: 'recent', rows: 3 } },
    ],
    0,
  );
  expect(fit.sections.map(({ id, rows }) => ({ id, rows }))).toEqual([
    { id: 'payments', rows: 2 },
    { id: 'recent', rows: 2 },
    { id: 'month', rows: 1 },
  ]);
});

it('gives spare space to a fallback section only when no visible list rows grow', () => {
  const sections = [
    { id: 'header', rows: 1, rowHeight: 10, required: true },
    { id: 'payments', rows: 1, rowHeight: 20, grow: true },
    { id: 'space', rows: 1, rowHeight: 1, required: true, fallbackGrow: true },
    { id: 'footer', rows: 1, rowHeight: 10, required: true },
  ];
  const withRows = fitWidgetSections(100, sections, 0);
  expect(withRows.sections.map((s) => [s.id, s.height])).toEqual([
    ['header', 10],
    ['payments', 79],
    ['space', 1],
    ['footer', 10],
  ]);
  const withoutRows = fitWidgetSections(30, sections, 0);
  expect(withoutRows.sections.map((s) => [s.id, s.height])).toEqual([
    ['header', 10],
    ['space', 10],
    ['footer', 10],
  ]);
});

it('reserves a section heading even when only its count fits, without charging it for each row', () => {
  const sections = [
    { id: 'balance', rows: 1, rowHeight: 10, required: true },
    { id: 'payments', rows: 4, rowHeight: 10, headingHeight: 5, moreHeight: 0, grow: true },
  ];
  expect(
    fitWidgetSections(50, sections, 0).sections.find((s) => s.id === 'payments'),
  ).toMatchObject({ rows: 3, more: 1 });
  expect(
    fitWidgetSections(17, sections, 0).sections.find((s) => s.id === 'payments'),
  ).toMatchObject({ rows: 0, more: 4, height: 5 });
  expect(fitWidgetSections(14, sections, 0).sections.map((s) => s.id)).toEqual(['balance']);
  expect(
    fitWidgetSections(60, sections, 0).sections.find((s) => s.id === 'payments'),
  ).toMatchObject({ rows: 4, more: 0 });
});

it.each([0, 1])(
  'reserves the complete footer before an optional payment capped at %s',
  (maxRows) => {
    const v = fitWidgetSections(60, [
      { id: 'payments', rows: 1, maxRows, rowHeight: 72 },
      { id: 'footer', rows: 1, rowHeight: 49, required: true },
    ]);
    expect(v.fits).toBe(true);
    expect(v.sections.map((section) => section.id)).toEqual(['footer']);
    expect(v.sections[0].height).toBeGreaterThanOrEqual(49);
  },
);

it('stretches a list only after every row is drawn when growth requires completion', () => {
  const sections = [
    { id: 'groups', rows: 4, rowHeight: 30, moreHeight: 0, grow: 'when-complete' as const },
    { id: 'space', rows: 1, rowHeight: 1, required: true, fallbackGrow: true },
  ];
  const partial = fitWidgetSections(110, sections, 0);
  expect(partial.sections[0]).toMatchObject({ rows: 3, more: 1, rowHeight: 30, height: 90 });
  expect(partial.sections[1].height).toBe(20);
  expect(fitWidgetSections(110, sections.slice(0, 1), 0).sections[0]).toMatchObject({
    rows: 3,
    rowHeight: 30,
    height: 90,
  });
  const complete = fitWidgetSections(150, sections, 0);
  expect(complete.sections[0]).toMatchObject({ rows: 4, more: 0, rowHeight: 37, height: 149 });
});
