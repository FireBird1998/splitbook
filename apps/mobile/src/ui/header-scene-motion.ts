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

/** 0 at rest, 1 at the top of the rise, eased both ways on the native driver. */
export function useSceneRise(enabled: boolean, seconds: number) {
  const reduced = useReducedMotion();
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    rise.setValue(0);
    if (!enabled || reduced) return;
    const half = (toValue: number) =>
      Animated.timing(rise, {
        toValue,
        duration: seconds * 500,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
        isInteraction: false,
      });
    const animation = Animated.loop(Animated.sequence([half(1), half(0)]));
    animation.start();
    return () => {
      animation.stop();
      rise.setValue(0);
    };
  }, [enabled, reduced, rise, seconds]);
  return rise;
}

/** Where a drifting cloud leaves on the right and comes back in on the left, in dp from rest. */
export function cloudTravel(cloud: { x: number; w: number; seconds: number }, frameWidth: number) {
  const reach = frameWidth / 2 / SCENE_UNIT + 12;
  const exit = (SCENE_CENTRE + reach - cloud.x) * SCENE_UNIT;
  const entry = (SCENE_CENTRE - reach - cloud.w - cloud.x) * SCENE_UNIT;
  return {
    entry,
    exit,
    /** A cloud resting outside the picture starts from the left edge. */
    start: exit > 0 && entry < 0 ? 0 : entry,
    dpPerSecond: (CLOUD_CROSSING / cloud.seconds) * SCENE_UNIT,
  };
}

/** Sideways offset of one cloud in dp: it drifts right, leaves the picture and returns on the left. */
export function useCloudDrift(
  enabled: boolean,
  cloud: { x: number; w: number; seconds: number },
  frameWidth: number,
) {
  const reduced = useReducedMotion();
  const [offset] = useState(() => new Animated.Value(0));
  const { x, w, seconds } = cloud;
  useEffect(() => {
    offset.setValue(0);
    if (!enabled || reduced) return;
    const travel = cloudTravel({ x, w, seconds }, frameWidth);
    let animation: Animated.CompositeAnimation | undefined;
    let alive = true;
    const cross = (from: number) => {
      offset.setValue(from);
      animation = Animated.timing(offset, {
        toValue: travel.exit,
        duration: ((travel.exit - from) / travel.dpPerSecond) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      });
      animation.start(({ finished }) => {
        if (finished && alive) cross(travel.entry);
      });
    };
    cross(travel.start);
    return () => {
      alive = false;
      animation?.stop();
      offset.setValue(0);
    };
  }, [enabled, reduced, offset, x, w, seconds, frameWidth]);
  return offset;
}

const watchAppState = (changed: () => void) => {
  const subscription = AppState.addEventListener('change', changed);
  return () => subscription.remove();
};
/** Whether the app is in front. A scene stops its own loops in the background; it does not rely on the system pausing them. */
export function useForeground() {
  return useSyncExternalStore(watchAppState, () => AppState.currentState === 'active');
}
