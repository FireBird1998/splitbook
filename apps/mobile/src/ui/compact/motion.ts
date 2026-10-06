import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';

/**
 * Motion for loading cues (#331): one calm set of timings, short and without bounce. Every
 * animation runs on the native driver, so none of them renders React again while it runs.
 * With Android's "Remove animations" setting (reduce motion) on, nothing moves: loops rest and
 * content appears at once. The components that use these live in the compact kit; screens use
 * the components, never `Animated` themselves.
 */
export const motion = {
  /** One breath of the skeleton pulse: from its resting shade to the border shade and back. */
  pulse: 1600,
  /** One pass of the progress bar's segment across its track. */
  sweep: 1400,
  /** Content that replaces its placeholder fades in. */
  reveal: 200,
  /** A status line's old text fades out while the new one fades in. */
  status: 180,
} as const;

/** The skeletons' opacity at rest and at the top of a breath, over the border colour. */
export const pulseOpacity = { rest: 0.5, peak: 1 } as const;
/**
 * The progress bar's segment, as fractions of its track: its width, where a pass starts and
 * ends (fully off the track each side), and where it rests when motion is reduced.
 */
export const sweepTrack = { segment: 0.36, from: -0.36, to: 1, rest: 0.22 } as const;

// Reduce motion -----------------------------------------------------------------------------

/** Whether reduce motion is on; null until Android has answered. */
let reduced: boolean | null = null;
const watchers = new Set<() => void>();
let subscription: { remove: () => void } | null = null;

function setReduced(value: boolean) {
  if (reduced === value) return;
  reduced = value;
  for (const watcher of [...watchers]) watcher();
}

/**
 * Calls `onChange` each time reduce motion changes, until the returned function is called.
 * Android is asked again whenever something starts watching after nothing did, since a change
 * made while nobody listened was never heard; until it answers, nothing moves.
 */
function watchReducedMotion(onChange: () => void) {
  watchers.add(onChange);
  if (!subscription) {
    // Unknown until Android answers: nothing starts on an answer that may be out of date.
    reduced = null;
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => setReduced(false));
  }
  return () => {
    watchers.delete(onChange);
    if (watchers.size) return;
    subscription?.remove();
    subscription = null;
  };
}

/** Motion is allowed only once Android has said reduce motion is off. */
const moving = () => reduced === false;

/**
 * Whether reduce motion is on, for a choice made while rendering, such as a still mark in place
 * of a spinner. It renders again only when the setting changes.
 */
export function useReducedMotion() {
  return useSyncExternalStore(watchReducedMotion, () => reduced === true);
}

/** Keeps the setting known while `active`, without rendering again when it changes. */
function useWatchReducedMotion(active = true) {
  // Each mount watches with its own function: the set of watchers holds one entry per mount.
  useEffect(() => (active ? watchReducedMotion(() => undefined) : undefined), [active]);
}

// Skeleton pulse ----------------------------------------------------------------------------

/** One breath, 0 → 1 → 0 shaped like a sine, so a repeat has no seam. */
const breath = (t: number) => (1 - Math.cos(2 * Math.PI * t)) / 2;
const pulse = new Animated.Value(0);
const pulseShade = pulse.interpolate({
  inputRange: [0, 1],
  outputRange: [pulseOpacity.rest, pulseOpacity.peak],
});
let pulseUsers = 0;
let pulseLoop: Animated.CompositeAnimation | null = null;
let stopWatchingPulse: (() => void) | null = null;

/** Runs the one shared loop while a skeleton is mounted and motion is allowed; rests it otherwise. */
function syncPulse() {
  const run = pulseUsers > 0 && moving();
  if (run && !pulseLoop) {
    pulse.setValue(0);
    pulseLoop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: motion.pulse,
        easing: breath,
        useNativeDriver: true,
      }),
    );
    pulseLoop.start();
  } else if (!run && pulseLoop) {
    pulseLoop.stop();
    pulseLoop = null;
    pulse.setValue(0);
  }
}

/**
 * The skeletons' shared opacity. Every skeleton block on screen uses the same value, so they
 * breathe together; the loop runs while at least one is mounted and stops with the last.
 */
export function usePulse() {
  useEffect(() => {
    pulseUsers += 1;
    if (pulseUsers === 1) stopWatchingPulse = watchReducedMotion(syncPulse);
    syncPulse();
    return () => {
      pulseUsers -= 1;
      if (pulseUsers === 0) {
        stopWatchingPulse?.();
        stopWatchingPulse = null;
      }
      syncPulse();
    };
  }, []);
  return pulseShade;
}

// Progress sweep ----------------------------------------------------------------------------

/**
 * The progress bar's segment offset: a pass across its track, repeated while mounted. The
 * track's width comes from its layout, so the segment crosses any track exactly.
 */
export function useSweep() {
  const { width: window } = useWindowDimensions();
  const [sweep] = useState(() => {
    const at = new Animated.Value(sweepTrack.rest);
    const width = new Animated.Value(window);
    return {
      at,
      width,
      translateX: Animated.multiply(at, width),
      onLayout: (event: LayoutChangeEvent) => width.setValue(event.nativeEvent.layout.width),
    };
  });
  useEffect(() => {
    let running: Animated.CompositeAnimation | null = null;
    const sync = () => {
      if (moving() && !running) {
        sweep.at.setValue(sweepTrack.from);
        running = Animated.loop(
          Animated.timing(sweep.at, {
            toValue: sweepTrack.to,
            duration: motion.sweep,
            // Material's standard curve: it eases out of the left and settles into the right.
            easing: Easing.bezier(0.4, 0, 0.2, 1),
            useNativeDriver: true,
          }),
        );
        running.start();
      } else if (!moving() && running) {
        running.stop();
        running = null;
        sweep.at.setValue(sweepTrack.rest);
      }
    };
    const stopWatching = watchReducedMotion(sync);
    sync();
    return () => {
      stopWatching();
      running?.stop();
    };
  }, [sweep]);
  return { translateX: sweep.translateX, onLayout: sweep.onLayout };
}

// Reveal ------------------------------------------------------------------------------------

/** The opacity of content that replaces a placeholder; see `useReveal`. */
export type Reveal = Animated.Value;

/**
 * Content fades in where its placeholder was. `loading` is whether the component shows its
 * placeholder now: when it turns false, the content fades in from nothing. While loading, and
 * with reduce motion on, the content is fully shown. Null for a component that has never shown
 * a placeholder, so content that was already there stays exactly as it was. The fade stops when
 * the component unmounts or starts loading again.
 */
export function useReveal(loading: boolean): Reveal | null {
  // Known by the time the content arrives: the fade is decided as it renders.
  useWatchReducedMotion(loading);
  /** `loading` as of the last commit. */
  const committed = useRef(loading);
  const placeholder = useRef(loading);
  const fade = useMemo(() => {
    if (!placeholder.current && !loading) return null;
    const revealing = committed.current && !loading && moving();
    return { opacity: new Animated.Value(revealing ? 0 : 1), revealing };
  }, [loading]);
  useEffect(() => {
    committed.current = loading;
    if (loading) placeholder.current = true;
  }, [loading]);
  useEffect(() => {
    if (!fade?.revealing) return;
    const animation = Animated.timing(fade.opacity, {
      toValue: 1,
      duration: motion.reveal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fade]);
  return fade?.opacity ?? null;
}

// Status cross-fade -------------------------------------------------------------------------

/**
 * A status line's change: the text it replaced (null when there's nothing to fade out) and the
 * fade, from 0 to 1, the new text follows while the old one takes the reverse. A first render,
 * and any change with reduce motion on, shows the new text at once.
 */
export function useStatusFade(text: string) {
  useWatchReducedMotion();
  const committed = useRef(text);
  const change = useMemo(() => {
    const from = committed.current !== text && moving() ? committed.current : null;
    const fade = new Animated.Value(from === null ? 1 : 0);
    const out = fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
    return { from, fade, out };
  }, [text]);
  useEffect(() => {
    committed.current = text;
    if (change.from === null) return;
    const animation = Animated.timing(change.fade, {
      toValue: 1,
      duration: motion.status,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [text, change]);
  return change;
}
