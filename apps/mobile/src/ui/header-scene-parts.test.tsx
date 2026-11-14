import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { Animated } from 'react-native';
import HeaderScene from './header-scene';
import { SceneVisibility } from './scene-visibility';
import { useSceneClocks } from './header-scene-motion';
import beach from './header-scene-sprites/beach';
import type { MobileGroup } from '../data/types';
import { emitAppState, loop, setReduceMotion, timing } from '../test-utils/native';

const availability = vi.hoisted(() => ({ enabled: true }));
vi.mock('../config', () => ({
  get headerSceneMotionAvailable() {
    return availability.enabled;
  },
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('expo-sensors', () => ({
  Accelerometer: {
    isAvailableAsync: async () => true,
    setUpdateInterval: () => undefined,
    addListener: () => ({ remove: () => undefined }),
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  availability.enabled = true;
});
const group = {
  name: 'Goa Friends Trip',
  category: 'home',
  members: [],
  defaultCurrency: 'INR',
  alternateCurrencies: [],
} as unknown as MobileGroup;
const parts = beach.sprites.filter((sprite) => sprite.kind === 'part');
const main = parts.filter((sprite) => sprite.layer !== 'glow');
const glow = parts.filter((sprite) => sprite.layer === 'glow');
const hiddenAtRest = main.filter((sprite) => sprite.rest === 0);

async function scene(time: 'day' | 'night', props: { motion?: boolean; preview?: boolean } = {}) {
  let view!: ReturnType<typeof create>;
  const element = (more: { motion?: boolean } = {}) => (
    <SceneVisibility.Provider value={{ visible: true, onLayout: () => {} }}>
      <HeaderScene
        group={group}
        header={{ style: 'scene', scene: 'beach', time }}
        {...props}
        {...more}
      />
    </SceneVisibility.Provider>
  );
  await act(async () => {
    view = create(element());
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      view.root.findAll(
        (node) => (node.type as unknown) === 'View' && node.props.accessibilityRole === 'image',
      ),
    ).toHaveLength(1);
  });
  await act(async () => {});
  const pictures = () =>
    view.root.findAll((node) => (node.type as unknown) === 'AnimatedImage').length;
  return { view, pictures, update: (more: { motion?: boolean }) => view.update(element(more)) };
}

it('the generated Beach list carries water, animals, people and birds as parts', () => {
  // The owner's list for Beach: palms, boat, shimmer, drops, ripples, crab, villager, gull.
  expect(main.length).toBeGreaterThanOrEqual(20);
  expect(hiddenAtRest.length).toBeGreaterThanOrEqual(10);
  expect(glow.length).toBeGreaterThanOrEqual(3);
  const periods = new Set(parts.flatMap((part) => part.tracks!.map((track) => track.seconds)));
  // Drops fall in 1.2 s, the crab scuttles in 11 s, the villager's walk takes 34 s.
  for (const seconds of [1.2, 11, 34, 0.56]) expect(periods).toContain(seconds);
});

it('with Motion on every part is drawn and one clock runs per period; off, parts rest', async () => {
  emitAppState('active');
  setReduceMotion(false);
  const moving = await scene('day');
  const still = beach.sprites.filter((sprite) => sprite.layer !== 'glow').length;
  expect(moving.pictures()).toBe(still);
  const periods = new Set(parts.flatMap((part) => part.tracks!.map((track) => track.seconds)));
  const clocks = timing.mock.calls.filter(
    ([, config]) => config.toValue === 1 && periods.has((config.duration as number) / 1000),
  );
  // One clock for each period the scene uses, however many parts share it; three floats besides.
  expect(new Set(clocks.map(([, config]) => config.duration)).size).toBe(periods.size);
  for (const [, config] of timing.mock.calls)
    expect(config).toMatchObject({ useNativeDriver: true, isInteraction: false });
  const started = loop.mock.results.length;
  expect(started).toBeGreaterThanOrEqual(periods.size);

  await act(async () => moving.update({ motion: false }));
  // Drops, ripples and shimmer are only seen while they move, as on the web's still scene.
  expect(moving.pictures()).toBe(still - hiddenAtRest.length);
  for (const result of loop.mock.results) expect(result.value.stop).toHaveBeenCalled();
  // Nothing started again behind the stop.
  expect(loop.mock.results.length).toBe(started);
  act(() => moving.view.unmount());
});

it.each([
  ['Remove animations', async () => setReduceMotion(true)],
  ['the app going to the background', async () => emitAppState('background')],
])('stops every part clock on %s', async (_, leave) => {
  emitAppState('active');
  setReduceMotion(false);
  const { view } = await scene('day');
  expect(loop.mock.results.length).toBeGreaterThan(5);
  await act(async () => {
    await leave();
  });
  for (const result of loop.mock.results) expect(result.value.stop).toHaveBeenCalled();
  // The stopped scene is the still scene: nothing is left frozen part-way through a fall.
  expect(view.root.findAll((node) => (node.type as unknown) === 'AnimatedImage')).toHaveLength(
    beach.sprites.filter((sprite) => sprite.layer !== 'glow').length - hiddenAtRest.length,
  );
  await act(async () => {
    emitAppState('active');
    setReduceMotion(false);
  });
  act(() => view.unmount());
});

it('night movement (window flicker, lantern, halo) costs nothing by day', async () => {
  emitAppState('active');
  setReduceMotion(false);
  const day = await scene('day');
  const byDay = day.pictures();
  act(() => day.view.unmount());
  const night = await scene('night');
  // The glow layer and its parts exist only when the scene shows them.
  expect(night.pictures()).toBe(byDay + beach.sprites.filter((s) => s.layer === 'glow').length);
  expect(glow.some((part) => part.tracks!.some((track) => track.time === 'night'))).toBe(true);
  act(() => night.view.unmount());
});

it('the settings preview moves its parts; with motion unavailable nothing does', async () => {
  emitAppState('active');
  setReduceMotion(false);
  const preview = await scene('day', { preview: true });
  expect(loop.mock.results.length).toBeGreaterThan(5);
  act(() => preview.view.unmount());
  loop.mockClear();
  availability.enabled = false;
  const off = await scene('day');
  expect(loop).not.toHaveBeenCalled();
  act(() => off.view.unmount());
});

it('clocks return to the start when they stop, so a stopped scene is the still scene', async () => {
  const seen: { clocks?: Map<number, Animated.Value> } = {};
  function Probe({ on }: { on: boolean }) {
    seen.clocks = useSceneClocks(on, [1.2, 34]);
    return null;
  }
  emitAppState('active');
  setReduceMotion(false);
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<Probe on />);
  });
  expect([...seen.clocks!.keys()]).toEqual([1.2, 34]);
  act(() => seen.clocks!.get(34)!.setValue(0.4));
  await act(async () => view.update(<Probe on={false} />));
  expect((seen.clocks!.get(34) as unknown as { value: number }).value).toBe(0);
  act(() => view.unmount());
});
