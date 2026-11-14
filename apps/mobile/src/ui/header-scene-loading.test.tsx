import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import HeaderScene from './header-scene';
import type { MobileGroup } from '../data/types';
const load = vi.hoisted(() => {
  let resolve!: () => void;
  const waiting = new Promise<void>((done) => {
    resolve = done;
  });
  return { waiting, resolve };
});
vi.mock('@splitbook/shared/header-scenes/beach', async (original) => {
  await load.waiting;
  return original();
});
vi.mock('@splitbook/shared/header-scenes/sakura', () => {
  throw Error('Art import failed');
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
it('reserves 208 dp and the real card while art is pending, then swaps in the same-height scene', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(
      <HeaderScene group={group} header={{ style: 'scene', scene: 'beach', time: 'day' }} />,
    );
  });
  const loading = view.root.findAll(
    (node) =>
      (node.type as unknown) === 'View' && node.props.accessibilityLabel === 'Loading Header scene',
  );
  expect(loading).toHaveLength(1);
  expect(loading[0].props.style.height).toBe(208);
  expect(JSON.stringify(view.toJSON())).toContain('Maple House');
  await act(async () => {
    load.resolve();
    await import('@splitbook/shared/header-scenes/beach');
  });
  const scene = view.root.findAll(
    (node) => (node.type as unknown) === 'View' && node.props.accessibilityRole === 'image',
  );
  expect(scene).toHaveLength(1);
  expect(scene[0].props.style.height).toBe(208);
  act(() => view.unmount());
});
it('falls back to the Household Classic header on a rejected art import', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(
      <HeaderScene group={group} header={{ style: 'scene', scene: 'sakura', time: 'day' }} />,
    );
    await new Promise((done) => setTimeout(done, 20));
  });
  expect(view.toJSON()).toBeNull();
  act(() => view.unmount());
});
