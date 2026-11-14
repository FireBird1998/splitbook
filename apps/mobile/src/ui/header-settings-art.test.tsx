import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { HeaderSettings } from './header-settings';
import type { MobileGroup } from '../data/types';
import type { HeaderSettings as Settings } from '../data/header-settings';
const loaded = vi.hoisted(() => [] as string[]);
vi.mock('@splitbook/shared/header-scenes/sakura', async (original) => {
  loaded.push('sakura');
  return original();
});
vi.mock('@splitbook/shared/header-scenes/eco-city', async (original) => {
  loaded.push('eco-city');
  return original();
});
vi.mock('@splitbook/shared/header-scenes/mountain-village', async (original) => {
  loaded.push('mountain-village');
  return original();
});
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const group = {
  name: 'Maple House',
  category: 'home',
  members: [],
  defaultCurrency: 'INR',
  alternateCurrencies: [],
} as unknown as MobileGroup;
const header = { style: 'scene', scene: 'beach', time: 'day' } as const;
const state: Settings = {
  groupId: 'g',
  saved: header,
  draft: header,
  status: 'editing',
  message: null,
};
const vectors = new Set([
  'default',
  'G',
  'Path',
  'Polygon',
  'Circle',
  'Ellipse',
  'Rect',
  'Defs',
  'RadialGradient',
  'Stop',
]);
it('uses four raster Images and only the selected full-size scene, with zero vectors on Classic', async () => {
  let view!: ReturnType<typeof create>;
  const render = (draft: Settings['draft']) => (
    <HeaderSettings
      group={group}
      state={{ ...state, draft }}
      offline={false}
      motion
      motionMessage={null}
      tilt={true}
      tiltMessage={null}
      onTilt={() => {}}
      onMotion={() => {}}
      onChoose={() => {}}
      onSave={() => {}}
      onRetry={() => {}}
      onClose={() => {}}
    />
  );
  await act(async () => {
    view = create(render(header));
  });
  const count = () =>
    view.root.findAll((node) => typeof node.type === 'string' && vectors.has(node.type)).length;
  await vi.waitFor(
    async () => {
      await act(async () => {});
      expect(view.root.findAll((node) => (node.type as unknown) === 'Image')).toHaveLength(4);
      expect(view.root.findAll((node) => (node.type as unknown) === 'default')).toHaveLength(1);
    },
    { timeout: 5000 },
  );
  const beach = count();
  expect(view.root.findAll((node) => (node.type as unknown) === 'Image')).toHaveLength(4);
  expect(view.root.findAll((node) => (node.type as unknown) === 'default')).toHaveLength(1);
  expect(beach).toBeLessThanOrEqual(1500);
  expect(loaded).toEqual([]);
  await act(async () => {
    view.update(render({ ...header, scene: 'sakura' }));
  });
  await vi.waitFor(
    async () => {
      await act(async () => {});
      expect(JSON.stringify(view.toJSON())).toContain('cherry-blossom garden');
    },
    { timeout: 5000 },
  );
  const sakura = count();
  expect(loaded).toEqual(['sakura']);
  expect(sakura).toBeLessThanOrEqual(850);
  expect(view.root.findAll((node) => (node.type as unknown) === 'default')).toHaveLength(1);
  await act(async () => view.update(render({ ...header, style: 'classic' })));
  expect(count()).toBe(0);
  expect(view.root.findAll((node) => (node.type as unknown) === 'Image')).toHaveLength(4);
  act(() => view.unmount());
});
