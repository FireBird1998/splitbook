import { expect, it } from 'vitest';
import { fitWidgetSections } from './widget-sizing';

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
  expect(result.sections.map((s) => s.id)).toEqual(['balance', 'action']);
});
