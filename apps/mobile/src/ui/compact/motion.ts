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

/** Whether reduce motion is on; null until Android has first answered. */
let reduced: boolean | null = null;
const watchers = new Set<() => void>();
let listening = false;

function setReduced(value: boolean) {
  if (reduced === value) return;
  reduced = value;
  for (const watcher of [...watchers]) watcher();
}

/**
 * Calls `onChange` each time reduce motion changes, until the returned function is called.
 * The first watcher asks Android and starts listening for changes, for the rest of the app's
 * life: one listener, so the answer stays current between screens. Until Android first
 * answers, the setting counts as on, so nothing moves on a guess.
 */
function watchReducedMotion(onChange: () => void) {
  watchers.add(onChange);
  if (!listening) {
    listening = true;
    AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => setReduced(false));
  }
  return () => {
    watchers.delete(onChange);
  };
}

/** Motion is allowed only once Android has said reduce motion is off. */
const moving = () => reduced === false;

/**
 * Whether reduce motion is on, or not known yet, for a choice made while rendering, such as a
 * still mark in place of a spinner. It renders again only when that changes.
 */
export function useReducedMotion() {
  return useSyncExternalStore(watchReducedMotion, () => !moving());
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
  /** Whether this component has shown its placeholder. */
  const placeholder = useRef(loading);
  // Recomputed only when `loading` changes, so a render with it false after a placeholder is the
  // content arriving.
  const fade = useMemo(() => {
    if (!placeholder.current && !loading) return null;
    const revealing = !loading && moving();
    return { opacity: new Animated.Value(revealing ? 0 : 1), revealing };
  }, [loading]);
  useEffect(() => {
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

interface StatusChange {
  /**
   * New for each change, so the line draws it on views made for it. A finished fade leaves
   * its views' opacity where the native driver put it, which React doesn't know: views kept
   * for the next change, with a new fade, could show the new text at full strength, or the old
   * one, before the fade reached them (#331).
   */
  key: number;
  /** The text fading out; null when there's nothing to fade. */
  from: string | null;
  /** 0 to 1: the new text follows it while the old one takes the reverse (`out`). */
  fade: Animated.Value;
  out: Animated.AnimatedInterpolation<number>;
}

/**
 * A status line's change, as one fade from what is on screen to the final text. The text faded
 * out is the one last shown in full. A change that arrives while a fade is running (a refresh
 * ends a moment before its new time arrives) carries the same fade on to the newer text, so the
 * line never restarts from the old text or shows the one in between at full strength. The fade
 * starts at once, on the native driver, on views new to it (`key`), so the line never shows an
 * opacity a finished fade left behind. A first render, and any change with reduce motion on,
 * shows the new text at once.
 */
export function useStatusFade(text: string): StatusChange {
  useWatchReducedMotion();
  /** The text last shown in full. */
  const settled = useRef(text);
  /** The fade running now, if any. */
  const running = useRef<StatusChange | null>(null);
  /** The text this line shows now, for when a fade ends. */
  const latest = useRef(text);
  const changes = useRef(0);
  const change = useMemo(() => {
    if (running.current && settled.current !== text) return running.current;
    const from = settled.current !== text && moving() ? settled.current : null;
    const fade = new Animated.Value(from === null ? 1 : 0);
    const out = fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
    changes.current += 1;
    return { key: changes.current, from, fade, out };
  }, [text]);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  useEffect(() => {
    if (change.from === null) {
      settled.current = latest.current;
      return;
    }
    running.current = change;
    const animation = Animated.timing(change.fade, {
      toValue: 1,
      duration: motion.status,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (running.current === change) running.current = null;
      if (finished) settled.current = latest.current;
    });
    return () => {
      if (running.current === change) running.current = null;
      animation.stop();
    };
  }, [change]);
  return change;
}
