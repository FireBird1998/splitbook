import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupHeader } from './group-header';
import type { MobileGroup } from '../data/types';
const renderer = vi.hoisted(() => ({ loaded: 0 }));
vi.mock('./header-scene', () => {
  renderer.loaded++;
  return { default: () => null };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllEnvs());
it.each([
  { style: 'classic', enabled: true },
  { style: 'scene', enabled: false },
] as const)('never evaluates scene/sensor code for %s', async ({ style, enabled }) => {
  vi.stubEnv('EXPO_PUBLIC_HEADER_SCENES_ENABLED', String(enabled));
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(
      <GroupHeader
        group={
          {
            category: 'home',
            header: { style, scene: 'beach', time: 'day' },
          } as unknown as MobileGroup
        }
      />,
    );
  });
  expect(view.toJSON()).toBeNull();
  expect(renderer.loaded).toBe(0);
  act(() => view.unmount());
});
