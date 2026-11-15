import { act, create } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { Animated, Easing } from 'react-native';
import {
  cloudTravel,
  useCloudDrift,
  useForeground,
  useSceneRise,
  type SceneMotion,
} from './header-scene-motion';
import { emitAppState, loop, sequence, setReduceMotion, timing } from '../test-utils/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cloud = { x: 90, w: 100, seconds: 140 };
const seen: { rise?: Animated.Value; drift?: Animated.Value; foreground?: boolean } = {};
/** Decides as a Header scene does: Motion off is still; on but out of sight is paused. */
function Probe({ motion = true, visible = true }) {
  seen.foreground = useForeground();
  const state: SceneMotion = !motion ? 'still' : visible && seen.foreground ? 'running' : 'paused';
  seen.rise = useSceneRise(state, 7);
  seen.drift = useCloudDrift(state, cloud, 380);
  return null;
}
function Float({ state }: { state: SceneMotion }) {
  seen.rise = useSceneRise(state, 7);
  return null;
}
function Cloud({ state, at = cloud }: { state: SceneMotion; at?: typeof cloud }) {
  seen.drift = useCloudDrift(state, at, 380);
  return null;
}
const value = (animated?: Animated.Value) => (animated as unknown as { value: number }).value;
const running = () => ({
  loops: loop.mock.results.map((result) => result.value),
  drifts: timing.mock.results
    .map((result) => result.value)
    .filter((animation) => animation.value === seen.drift),
});
type StandIn = ReturnType<typeof timing>;
/** The animation started last: what the picture plays now. */
const playing = (): StandIn =>
  [...loop.mock.results, ...sequence.mock.results, ...timing.mock.results]
    .map((result) => result.value as StandIn)
    .filter((animation) => animation.start.mock.calls.length > 0)
    .sort((a, b) => a.start.mock.invocationCallOrder[0] - b.start.mock.invocationCallOrder[0])
    .at(-1)!;
const finish = (animation: StandIn) =>
  act(() => animation.start.mock.calls[0][0]({ finished: true }));
const leg = (animation: StandIn) => [
  animation.config!.toValue,
  Math.round(animation.config!.duration as number),
];

it('starts the float and the drift on the native driver only while running', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Probe visible={false} />);
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
  // The float is half a period up and half back down, eased both ways; its value goes on to 2
  // on the way down, so where it is says which half it is in.
  const rises = timing.mock.calls.filter(([animated]) => animated === seen.rise);
  expect(rises.map(([, config]) => [config.toValue, config.duration, config.easing])).toEqual([
    [1, 3500, Easing.inOut(Easing.quad)],
    [2, 3500, Easing.inOut(Easing.quad)],
  ]);
  // The drift is a slow straight line.
  expect(drifts[0].config.duration).toBeGreaterThan(20_000);
  expect(drifts[0].config.easing).toBe(Easing.linear);
  act(() => view.unmount());
});

it.each([
  ['Motion off', async (view: ReturnType<typeof create>) => view.update(<Probe motion={false} />)],
  ['Remove animations', async () => setReduceMotion(true)],
])('%s stops both loops and returns the pictures to rest', async (_, leave) => {
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
  // Back on, both start from the beginning: a whole float from rest, the first crossing from
  // where the cloud rests.
  await act(async () => {
    setReduceMotion(false);
    view.update(<Probe />);
  });
  expect(running().loops).toHaveLength(2);
  expect(running().drifts).toHaveLength(2);
  expect(value(seen.rise)).toBe(0);
  expect(value(seen.drift)).toBe(0);
  act(() => view.unmount());
});

it.each([
  [
    'the scene going off screen or under a sheet',
    async (view: ReturnType<typeof create>) => view.update(<Probe visible={false} />),
  ],
  ['the app going to the background', async () => emitAppState('background')],
])('%s stops both loops and holds the pictures where they are', async (_, leave) => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    emitAppState('active');
    setReduceMotion(false);
    view = create(<Probe />);
  });
  const { loops, drifts } = running();
  act(() => {
    (seen.rise as Animated.Value).setValue(0.6);
    (seen.drift as Animated.Value).setValue(42);
  });
  await act(async () => {
    await leave(view);
  });
  expect(loops[0].stop).toHaveBeenCalled();
  expect(drifts[0].stop).toHaveBeenCalled();
  // Paused, not reset: a scene still on screen under the Group's options does not jump.
  expect(value(seen.rise)).toBe(0.6);
  expect(value(seen.drift)).toBe(42);
  expect(running().loops).toHaveLength(1);
  expect(running().drifts).toHaveLength(1);
  await act(async () => emitAppState('active'));
  act(() => view.unmount());
});

it('unmounting stops both loops', async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    emitAppState('active');
    setReduceMotion(false);
    view = create(<Probe />);
  });
  const { loops, drifts } = running();
  act(() => view.unmount());
  expect(loops[0].stop).toHaveBeenCalled();
  expect(drifts[0].stop).toHaveBeenCalled();
});

it.each([
  // On the way up: the rest of the rise, then the whole way down.
  [
    0.6,
    [
      [1, 1400],
      [2, 3500],
    ],
  ],
  // At the top: the whole way down.
  [1, [[2, 3500]]],
  // On the way down: the rest of the fall.
  [1.5, [[2, 1750]]],
])('a float held at %s carries on from there, then floats whole cycles', async (held, rest) => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Float state="running" />);
  });
  act(() => (seen.rise as Animated.Value).setValue(held));
  await act(async () => view.update(<Float state="paused" />));
  const before = timing.mock.calls.length;
  const loops = loop.mock.calls.length;
  await act(async () => view.update(<Float state="running" />));
  // The rest of the half it was paused in, eased as before and in the same share of its time.
  const legs = timing.mock.results.slice(before).map((result) => leg(result.value));
  expect(legs).toEqual(rest);
  for (const [, config] of timing.mock.calls.slice(before))
    expect(config.easing).toEqual(Easing.inOut(Easing.quad));
  expect(value(seen.rise)).toBe(held);
  expect(loop.mock.calls.length).toBe(loops);
  // Back at rest, whole floats again.
  finish(playing());
  expect(loop.mock.calls.length).toBe(loops + 1);
  expect(value(seen.rise)).toBe(0);
  act(() => view.unmount());
});

it('a cloud held part-way across carries on from there, then makes whole crossings', async () => {
  const travel = cloudTravel(cloud, 380);
  const seconds = (from: number) => Math.round(((travel.exit - from) / travel.dpPerSecond) * 1000);
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Cloud state="running" />);
  });
  const first = playing();
  act(() => (seen.drift as Animated.Value).setValue(42));
  await act(async () => view.update(<Cloud state="paused" />));
  expect(value(seen.drift)).toBe(42);
  // A crossing that reports its end after the pause starts nothing.
  const made = timing.mock.calls.length;
  finish(first);
  expect(timing.mock.calls.length).toBe(made);
  expect(value(seen.drift)).toBe(42);
  await act(async () => view.update(<Cloud state="running" />));
  // From where it was held to the right edge, at the same speed.
  expect(leg(playing())).toEqual([travel.exit, seconds(42)]);
  expect(value(seen.drift)).toBe(42);
  // Then in again from the left edge, the whole way across.
  finish(playing());
  expect(leg(playing())).toEqual([travel.exit, seconds(travel.entry)]);
  expect(value(seen.drift)).toBe(travel.entry);
  act(() => view.unmount());
});

it.each([
  ['resting inside the picture starts from where it rests', cloud, () => 0],
  [
    'resting outside the picture starts from the left edge',
    { x: 600, w: 100, seconds: 140 },
    (travel: ReturnType<typeof cloudTravel>) => travel.entry,
  ],
])('a cloud %s', async (_, at, from) => {
  const travel = cloudTravel(at, 380);
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Cloud state="running" at={at} />);
  });
  expect(value(seen.drift)).toBe(from(travel));
  expect(leg(playing())).toEqual([
    travel.exit,
    Math.round(((travel.exit - from(travel)) / travel.dpPerSecond) * 1000),
  ]);
  act(() => view.unmount());
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
