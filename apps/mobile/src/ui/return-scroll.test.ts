import { describe, expect, it } from 'vitest';
import { returnScrollTarget, visibleRowAnchor } from './return-scroll';

// Native row layouts in scroll-content coordinates; no React Native or guessed font heights.
const rows = new Map([
  ['rent', { top: 400, height: 80 }],
  ['groceries', { top: 520, height: 120 }],
]);
describe('returning to a laid-out row (#225)', () => {
  it('records no anchor while only the header is visible', () => {
    expect(visibleRowAnchor(rows, 0, 300)).toBeUndefined();
  });

  it('keeps a partially visible row at large text with different row heights', () => {
    const large = new Map([
      ['rent', { top: 700, height: 160 }],
      ['groceries', { top: 930, height: 260 }],
    ]);
    expect(visibleRowAnchor(large, 790)).toEqual({ key: 'rent', offset: 90 });
    expect(
      returnScrollTarget(
        { y: 790, anchor: { key: 'rent', offset: 90 } },
        new Map([['rent', { top: 980, height: 160 }]]),
        { content: 2300, viewport: 600 },
      ),
    ).toBe(1070);
  });

  it.each(['deleted', 'moved to another Month'])(
    'clamps the old offset when the row was %s',
    () => {
      expect(
        returnScrollTarget({ y: 1800, anchor: { key: 'missing', offset: 25 } }, rows, {
          content: 1200,
          viewport: 700,
        }),
      ).toBe(500);
    },
  );

  it('clamps an anchor near the end, and allows the first row below a header', () => {
    expect(
      returnScrollTarget({ y: 550, anchor: { key: 'groceries', offset: 30 } }, rows, {
        content: 800,
        viewport: 600,
      }),
    ).toBe(200);
    expect(visibleRowAnchor(rows, 350)).toEqual({ key: 'rent', offset: -50 });
    expect(visibleRowAnchor(rows, 900)).toBeUndefined();
  });

  it('follows identity after rows reorder instead of choosing the row at its old index', () => {
    const reordered = new Map([
      ['groceries', { top: 100, height: 120 }],
      ['rent', { top: 280, height: 80 }],
    ]);
    expect(
      returnScrollTarget({ y: 550, anchor: { key: 'groceries', offset: 30 } }, reordered, {
        content: 1600,
        viewport: 600,
      }),
    ).toBe(130);
  });

  it('finds the first row on screen and follows that identity after rows above it change', () => {
    const anchor = visibleRowAnchor(rows, 550);
    expect(anchor).toEqual({ key: 'groceries', offset: 30 });
    const grown = new Map([['groceries', { top: 720, height: 180 }]]);
    expect(returnScrollTarget({ y: 550, anchor }, grown, { content: 1600, viewport: 600 })).toBe(
      750,
    );
  });
});
