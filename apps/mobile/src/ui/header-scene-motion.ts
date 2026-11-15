import { useEffect, useState, useSyncExternalStore } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import { useReducedMotion } from './compact/motion';

/** Scene units are drawn at this many dp: the 240-unit scene fills the 208 dp picture. */
export const SCENE_UNIT = 208 / 240;
/** The scene unit that sits at the middle of the picture: the main island's centre. */
export const SCENE_CENTRE = 300;
/** Float rise in scene units, as on the web. */
export const FLOAT_RISE = 3;
/** One web cloud crossing covers this many scene units. */
const CLOUD_CROSSING = 1360;

/**
 * How far each layer moves at full tilt, in dp. Layers behind the main island move against the
 * ones in front of it, so the picture turns about the island and stays within a few pixels.
 */
export const TILT_DEPTH = { sky: -1, far: -4, clouds: -3, main: -1.5, glow: -1.5, front: 5 };

/**
 * How a scene's float and clouds move. Paused holds them where they are: a paused scene can still
 * be on screen (scrolled part-way, under the Group's options), so nothing may jump when it stops or
 * starts. Still puts them back at rest, as the web's still scene has them: Motion off, Remove
 * animations, or a scene that is changing.
 */
export type SceneMotion = 'running' | 'paused' | 'still';

/**
 * One looping animation of a scene value on the native driver, which a pause holds in place.
 * `run` reads back where the native driver left the value, plays `remainder(from)`, what is
 * left of the cycle it was paused in (nothing at the start of one), then `cycle()` each time the
 * one before it finishes. The value alone says where in its cycle it is, so that place is all a run
 * needs.
 */
function sceneLoop(value: Animated.Value) {
  let current: Animated.CompositeAnimation | undefined;
  // Moves on at every run and stop, so a place that comes back late is used only by the run
  // that asked for it.
  let turn = 0;
  const stop = () => {
    turn += 1;
    current?.stop();
    current = undefined;
  };
  return {
    run(
      remainder: (from: number) => Animated.CompositeAnimation | undefined,
      cycle: () => Animated.CompositeAnimation,
    ) {
      stop();
      const mine = turn;
      const play = (animation: Animated.CompositeAnimation) => {
        current = animation;
        animation.start(({ finished }) => {
          if (finished && turn === mine) play(cycle());
        });
      };
      value.stopAnimation((from) => {
        if (turn === mine) play(remainder(from) ?? cycle());
      });
    },
    /** Stops where the native driver has it and holds that place for the next run. */
    pause() {
      stop();
      value.stopAnimation((held) => value.setValue(held));
    },
    /** Stops and goes back to rest, after any place still on its way back so that cannot undo it. */
    rest() {
      stop();
      value.stopAnimation(() => value.setValue(0));
    },
    /** Stops for good: the scene and its values are going, so nothing is read back. */
    end: stop,
  };
}

/**
 * The float on the native driver: 0 at rest, 1 at the top of the rise and 2 back at rest, eased
 * each way. Going on to 2 instead of back to 0 lets a pause tell which half it was in.
 */
export function useSceneRise(motion: SceneMotion, seconds: number) {
  const reduced = useReducedMotion();
  const [rise] = useState(() => new Animated.Value(0));
  const [loop] = useState(() => sceneLoop(rise));
  const state = reduced ? 'still' : motion;
  useEffect(() => {
    if (state !== 'running') {
      if (state === 'still') loop.rest();
      else loop.pause();
      return;
    }
    /** Up to 1 or down to 2, over this share of half a period. */
    const half = (toValue: number, share: number) =>
      Animated.timing(rise, {
        toValue,
        duration: share * seconds * 500,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
        isInteraction: false,
      });
    loop.run(
      (from) =>
        from > 0 && from < 1
          ? Animated.sequence([half(1, 1 - from), half(2, 1)])
          : from >= 1 && from < 2
            ? half(2, 2 - from)
            : undefined,
      () => {
        // The end of one float and the start of the next are the same pose.
        rise.setValue(0);
        return Animated.loop(Animated.sequence([half(1, 1), half(2, 1)]));
      },
    );
  }, [loop, rise, seconds, state]);
  useEffect(() => loop.end, [loop]);
  return rise;
}

/** What follows the float: `rest` at rest (0 and 2), `top` at the top of the rise (1). */
export const riseBetween = (rise: Animated.Value, rest: number, top: number) =>
  rise.interpolate({ inputRange: [0, 1, 2], outputRange: [rest, top, rest] });

/** Where a drifting cloud leaves on the right and comes back in on the left, in dp from rest. */
export function cloudTravel(cloud: { x: number; w: number; seconds: number }, frameWidth: number) {
  const reach = frameWidth / 2 / SCENE_UNIT + 12;
  const exit = (SCENE_CENTRE + reach - cloud.x) * SCENE_UNIT;
  const entry = (SCENE_CENTRE - reach - cloud.w - cloud.x) * SCENE_UNIT;
  return {
    entry,
    exit,
    dpPerSecond: (CLOUD_CROSSING / cloud.seconds) * SCENE_UNIT,
  };
}

/** Sideways offset of one cloud in dp: it drifts right, leaves the picture and returns on the left. */
export function useCloudDrift(
  motion: SceneMotion,
  cloud: { x: number; w: number; seconds: number },
  frameWidth: number,
) {
  const reduced = useReducedMotion();
  const [offset] = useState(() => new Animated.Value(0));
  const [loop] = useState(() => sceneLoop(offset));
  const state = reduced ? 'still' : motion;
  const { x, w, seconds } = cloud;
  useEffect(() => {
    if (state !== 'running') {
      if (state === 'still') loop.rest();
      else loop.pause();
      return;
    }
    const travel = cloudTravel({ x, w, seconds }, frameWidth);
    const cross = (from: number) => {
      offset.setValue(from);
      return Animated.timing(offset, {
        toValue: travel.exit,
        duration: ((travel.exit - from) / travel.dpPerSecond) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      });
    };
    loop.run(
      // Part-way across, or resting inside the picture: on from there. A cloud resting outside
      // the picture comes in from the left edge.
      (from) => (from >= travel.entry && from < travel.exit ? cross(from) : undefined),
      () => cross(travel.entry),
    );
  }, [loop, offset, state, x, w, seconds, frameWidth]);
  useEffect(() => loop.end, [loop]);
  return offset;
}

/**
 * One 0-to-1 clock per period, running straight on the native driver. Every part with that
 * period reads its place from the same clock, so a scene runs a dozen loops, not one per part.
 *
 * A pause stops a clock where it is and the next run finishes that cycle first (`sceneLoop`). A
 * clock whose period is no longer wanted stops; the others are left running.
 */
export function useSceneClocks(enabled: boolean, periods: readonly number[]) {
  const reduced = useReducedMotion();
  const [clocks] = useState(() => new Map<number, Animated.Value>());
  const [loops] = useState(() => new Map<number, ReturnType<typeof sceneLoop>>());
  const [running] = useState(() => new Set<number>());
  for (const seconds of periods)
    if (!clocks.has(seconds)) {
      const clock = new Animated.Value(0);
      clocks.set(seconds, clock);
      loops.set(seconds, sceneLoop(clock));
    }
  const key = periods.join(',');
  useEffect(() => {
    const wanted = new Set(enabled && !reduced ? key.split(',').filter(Boolean).map(Number) : []);
    for (const seconds of running)
      if (!wanted.has(seconds)) {
        running.delete(seconds);
        loops.get(seconds)!.pause();
      }
    for (const seconds of wanted) {
      if (running.has(seconds)) continue;
      running.add(seconds);
      const clock = clocks.get(seconds)!;
      const run = (toValue: number, duration: number) =>
        Animated.timing(clock, {
          toValue,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
          isInteraction: false,
        });
      loops.get(seconds)!.run(
        // The rest of the cycle it was paused in, straight.
        (from) => (from > 0 && from < 1 ? run(1, (1 - from) * seconds * 1000) : undefined),
        () => {
          // The end of one cycle and the start of the next are the same pose.
          clock.setValue(0);
          return Animated.loop(run(1, seconds * 1000));
        },
      );
    }
  }, [enabled, reduced, clocks, loops, running, key]);
  useEffect(
    () => () => {
      for (const loop of loops.values()) loop.end();
      running.clear();
    },
    [loops, running],
  );
  return clocks;
}

const watchAppState = (changed: () => void) => {
  const subscription = AppState.addEventListener('change', changed);
  return () => subscription.remove();
};
/** Whether the app is in front. A scene stops its own loops in the background; it does not rely on the system pausing them. */
export function useForeground() {
  return useSyncExternalStore(watchAppState, () => AppState.currentState === 'active');
}
