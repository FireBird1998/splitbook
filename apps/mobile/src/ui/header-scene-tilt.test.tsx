import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import HeaderScene from './header-scene';
import { SceneVisibility } from './scene-visibility';
import type { MobileGroup } from '../data/types';
import { headerSceneMotionAvailable } from '../config';
const availability = vi.hoisted(() => ({ enabled: false }));
const native = vi.hoisted(() => ({ listeners: 0, loaded: 0 }));
vi.mock('../config', () => ({
  get headerSceneMotionAvailable() {
    return availability.enabled;
  },
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('expo-sensors', () => {
  native.loaded++;
  return {
    Accelerometer: {
      isAvailableAsync: async () => true,
      setUpdateInterval: vi.fn(),
      addListener: () => {
        native.listeners++;
        return {
          remove: () => {
            native.listeners--;
          },
        };
      },
    },
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const group = {
  name: 'Household',
  category: 'home',
  members: [],
  defaultCurrency: 'INR',
  alternateCurrencies: [],
} as unknown as MobileGroup;
function Scene({ motion = true, tilt = true, visible = true, uncovered = true, preview = false }) {
  return (
    <SceneVisibility.Provider value={{ visible: uncovered, onLayout: () => {} }}>
      <HeaderScene
        group={group}
        header={{ style: 'scene', scene: 'beach', time: 'day' }}
        motion={motion}
        tilt={tilt}
        visible={visible}
        preview={preview}
      />
    </SceneVisibility.Provider>
  );
}
it('the rendered still fallback never evaluates sensors, with both phone choices on', async () => {
  expect(headerSceneMotionAvailable).toBe(false);
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Scene />);
  });
  await vi.waitFor(
    async () => {
      await act(async () => {});
      expect(
        view.root.findAll(
          (node) => (node.type as unknown) === 'View' && node.props.accessibilityRole === 'image',
        ),
      ).toHaveLength(1);
    },
    { timeout: 5000 },
  );
  expect(native.loaded).toBe(0);
  expect(native.listeners).toBe(0);
  act(() => view.unmount());
});
it('the rendered available scene applies every phone/visibility gate; previews never subscribe', async () => {
  availability.enabled = true;
  let view!: ReturnType<typeof create>;
  try {
    await act(async () => {
      view = create(<Scene />);
    });
    await vi.waitFor(
      async () => {
        await act(async () => {});
        expect(native.listeners).toBe(1);
      },
      { timeout: 5000 },
    );
    for (const props of [
      { motion: false },
      { tilt: false },
      { visible: false },
      { uncovered: false },
      { preview: true },
    ]) {
      await act(async () => view.update(<Scene {...props} />));
      await vi.waitFor(
        async () => {
          await act(async () => {});
          expect(native.listeners).toBe(0);
        },
        { timeout: 5000 },
      );
      await act(async () => view.update(<Scene />));
      await vi.waitFor(
        async () => {
          await act(async () => {});
          expect(native.listeners).toBe(1);
        },
        { timeout: 5000 },
      );
    }
  } finally {
    act(() => view.unmount());
    availability.enabled = false;
  }
  expect(native.listeners).toBe(0);
});
