import { expect, it } from 'vitest';
import { Model, makeRenderer } from './engine';

const renderer = makeRenderer({ stone: { c: '#888888' }, leaf: { c: '#66aa55' } });
it('removes a hidden cube even when the covering cube belongs to an animated layer', () => {
  const model = new Model();
  model.set(0, 0, 0, 'stone');
  // Same projected footprint, nearer to the viewer along (1,1,1).
  model.set(1, 1, 1, 'leaf', { g: 'sway' });
  const scene = renderer.render(model, 4);
  expect(scene.coverage.base).toHaveLength(0);
  expect(scene.coverage.groups.sway).toHaveLength(6);
  expect(scene.visible(0, 0, 0)).toBe(false);
  expect(scene.visible(1, 1, 1)).toBe(true);
});
it('partitions partial faces across static and moving layers without a repeated surface cell', () => {
  const model = new Model();
  model.set(0, 0, 0, 'stone');
  model.set(1, 0, 0, 'leaf', { g: 'sway' });
  const { coverage } = renderer.render(model, 4);
  const cells = [...coverage.base, ...Object.values(coverage.groups).flat()];
  expect(coverage.base).toHaveLength(4);
  expect(coverage.groups.sway).toHaveLength(6);
  expect(new Set(cells).size).toBe(10);
});
it('rejects a missing material instead of generating unusable colours', () => {
  const model = new Model();
  model.set(0, 0, 0, 'missing');
  expect(() => renderer.render(model, 4)).toThrow('no material missing');
});
