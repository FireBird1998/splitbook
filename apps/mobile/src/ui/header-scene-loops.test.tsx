import { act, create } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { Animated } from 'react-native';
import { useCloudDrift, useForeground, useSceneRise } from './header-scene-motion';
import { emitAppState, loop, setReduceMotion, timing } from '../test-utils/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cloud = { x: 90, w: 100, seconds: 140 };
const seen: { rise?: Animated.Value; drift?: Animated.Value; foreground?: boolean } = {};
function Probe({ moving = true }) {
  seen.foreground = useForeground();
  const on = moving && seen.foreground;
  seen.rise = useSceneRise(on, 7);
  seen.drift = useCloudDrift(on, cloud, 380);
  return null;
}
const value = (animated?: Animated.Value) => (animated as unknown as { value: number }).value;
const running = () => ({
  loops: loop.mock.results.map((result) => result.value),
  drifts: timing.mock.results
    .map((result) => result.value)
    .filter((animation) => animation.value === seen.drift),
});

it('starts the float and the drift on the native driver only while moving', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Probe moving={false} />);
  });
  expect(loop).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();

  await act(async () => view.update(<Probe />));
  const { loops, drifts } = running();
  expect(loops).toHaveLength(1);
  expect(loops[0].start).toHaveBeenCalledTimes(1);
  expect(drifts).toHaveLength(1);
  expect(drifts[0].start).toHaveBeenCalledTimes(1);
  // Every timing either hook made runs off the JS thread and never blocks interactions.
  expect(timing.mock.calls.length).toBeGreaterThanOrEqual(3);
  for (const [, config] of timing.mock.calls)
    expect(config).toMatchObject({ useNativeDriver: true, isInteraction: false });
  // The float is half a period up and half down; the drift is a slow straight line.
  const rises = timing.mock.calls.filter(([animated]) => animated === seen.rise);
  expect(rises.map(([, config]) => [config.toValue, config.duration])).toEqual([
    [1, 3500],
    [0, 3500],
  ]);
  expect(drifts[0].config.duration).toBeGreaterThan(20_000);
  act(() => view.unmount());
});

it.each([
  [
    'Motion off or hidden',
    async (view: ReturnType<typeof create>) => view.update(<Probe moving={false} />),
  ],
  ['Remove animations', async () => setReduceMotion(true)],
  ['the app going to the background', async () => emitAppState('background')],
  ['unmount', async (view: ReturnType<typeof create>) => view.unmount()],
])('stops both loops and returns the pictures to rest on %s', async (_, leave) => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    emitAppState('active');
    setReduceMotion(false);
    view = create(<Probe />);
  });
  const { loops, drifts } = running();
  expect(loops).toHaveLength(1);
  expect(drifts).toHaveLength(1);
  // Pretend the native driver has moved both pictures.
  act(() => {
    (seen.rise as Animated.Value).setValue(0.6);
    (seen.drift as Animated.Value).setValue(42);
  });
  await act(async () => {
    await leave(view);
  });
  expect(loops[0].stop).toHaveBeenCalled();
  expect(drifts[0].stop).toHaveBeenCalled();
  expect(value(seen.rise)).toBe(0);
  expect(value(seen.drift)).toBe(0);
  // Nothing was restarted behind the stop.
  expect(running().loops).toHaveLength(1);
  expect(running().drifts).toHaveLength(1);
  await act(async () => {
    emitAppState('active');
    setReduceMotion(false);
  });
  try {
    act(() => view.unmount());
  } catch {
    // already unmounted by the case under test
  }
});

it('starts again when the app returns to the foreground', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    emitAppState('background');
    view = create(<Probe />);
  });
  expect(seen.foreground).toBe(false);
  expect(loop).not.toHaveBeenCalled();
  await act(async () => emitAppState('active'));
  expect(seen.foreground).toBe(true);
  expect(running().loops).toHaveLength(1);
  expect(running().loops[0].start).toHaveBeenCalledTimes(1);
  act(() => view.unmount());
});
