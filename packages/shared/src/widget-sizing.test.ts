import { expect, it } from 'vitest';
import { fitWidgetSections } from './widget-sizing';

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
