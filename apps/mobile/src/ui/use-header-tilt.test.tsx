import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useHeaderTilt } from './use-header-tilt';
import { emitAppState, setReduceMotion, timing } from '../test-utils/native';
const native = vi.hoisted(() => ({
  count: 0,
  loaded: 0,
  removed: 0,
  listener: undefined as ((sample: { x: number; y: number }) => void) | undefined,
}));
vi.mock('expo-sensors', () => {
  native.loaded++;
  return {
    Accelerometer: {
      isAvailableAsync: async () => true,
      setUpdateInterval: vi.fn(),
      addListener: (listener: (sample: { x: number; y: number }) => void) => {
        native.listener = listener;
        native.count++;
        return {
          remove: () => {
            native.count--;
            native.removed++;
          },
        };
      },
    },
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Probe({ motion = true, tilt = true, visible = true, available = true }) {
  useHeaderTilt(motion && tilt && visible && available);
  return null;
}
it('an unavailable build never loads the sensor module', async () => {
  const before = native.loaded;
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Probe available={false} />);
  });
  expect(native.loaded).toBe(before);
  expect(native.count).toBe(0);
  act(() => view.unmount());
});
it('pins sensor cleanup for visibility, Motion, Tilt, foreground, reduced motion and unmount', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    setReduceMotion(false);
    view = create(<Probe />);
  });
  expect(native.count).toBe(1);
  for (const props of [
    { motion: false },
    { tilt: false },
    { visible: false },
    { available: false },
  ]) {
    await act(async () => {
      view.update(<Probe {...props} />);
    });
    expect(native.count).toBe(0);
    await act(async () => {
      view.update(<Probe />);
    });
    expect(native.count).toBe(1);
  }
  for (const state of ['background', 'inactive']) {
    await act(async () => emitAppState(state));
    expect(native.count).toBe(0);
    await act(async () => emitAppState('active'));
    expect(native.count).toBe(1);
  }
  await act(async () => setReduceMotion(true));
  expect(native.count).toBe(0);
  await act(async () => setReduceMotion(false));
  expect(native.count).toBe(1);
  act(() => view.unmount());
  expect(native.count).toBe(0);
});
it('never starts a listener when mounted in the background', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    emitAppState('background');
    view = create(<Probe />);
  });
  expect(native.count).toBe(0);
  act(() => view.unmount());
});

it('eases bounded samples on the native driver without React state updates', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Probe />);
  });
  expect(native.count).toBe(1);
  act(() => {
    native.listener?.({ x: 0, y: 1 });
    native.listener?.({ x: 5, y: -5 });
  });
  expect(timing.mock.calls.at(-2)?.[1]).toMatchObject({
    toValue: 1,
    duration: 120,
    useNativeDriver: true,
    isInteraction: false,
  });
  expect(timing.mock.calls.at(-1)?.[1]).toMatchObject({
    toValue: -1,
    duration: 120,
    useNativeDriver: true,
    isInteraction: false,
  });
  const animations = timing.mock.results.map((result) => result.value);
  act(() => view.unmount());
  expect(animations.at(-1)?.stop).toHaveBeenCalled();
  expect(native.count).toBe(0);
});
