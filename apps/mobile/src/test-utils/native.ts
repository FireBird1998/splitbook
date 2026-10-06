import { vi } from 'vitest';

// Stand-ins for React Native, react-native-safe-area-context and Ionicons, mocked for every test
// file by `./setup.ts`. Components render as host names ('View', 'Pressable', …), so a rendered
// tree keeps the props (roles, labels, states, handlers) that Android receives.
//
// Tests change the stand-ins through the helpers below. After every test the stand-ins return to
// the file's defaults and their recorded calls are cleared, so tests pass in any order.

type Window = { width: number; height: number; scale: number; fontScale: number };

const phone: Window = { width: 412, height: 915, scale: 2, fontScale: 1 };
let fileWindow: Window = { ...phone };
const currentWindow: Window = { ...phone };
const appStateListeners: ((state: string) => void)[] = [];
const connectionListeners: ((state: { isConnected: boolean | null }) => void)[] = [];
const backListeners: (() => boolean)[] = [];
const reduceMotionListeners: ((enabled: boolean) => void)[] = [];
let reduceMotion = false;

/**
 * Sets the window every test in this file starts from; call it at the top of the file.
 * Without it, tests lay out for 412×915 at 1× text.
 */
export function setFileWindow(size: Partial<Window>) {
  fileWindow = { ...phone, ...size };
  Object.assign(currentWindow, fileWindow);
}

/** Changes the window size and text scale for the rest of the current test. */
export function setWindow(size: Partial<Window>) {
  Object.assign(currentWindow, size);
}

/** Android reports a new app state, e.g. 'active' when the app returns to the foreground. */
export function emitAppState(state: string) {
  for (const listener of [...appStateListeners]) listener(state);
}

/** NetInfo reports the device's connection: false when it drops, true when it's back. */
export function emitConnection(isConnected: boolean) {
  for (const listener of [...connectionListeners]) listener({ isConnected });
}

/** Android's hardware or gesture Back; returns whether a listener handled it. */
export function pressBack() {
  return backListeners.some((listener) => listener());
}

/** How many Back listeners are registered, e.g. to check the App is listening at all. */
export function backListenerCount() {
  return backListeners.length;
}

/**
 * Android's "Remove animations" setting (reduce motion) changes; off unless a test turns it on.
 * `AccessibilityInfo.isReduceMotionEnabled` answers with it, and its listeners hear the change.
 */
export function setReduceMotion(enabled: boolean) {
  reduceMotion = enabled;
  for (const listener of [...reduceMotionListeners]) listener(enabled);
}

/** `Animated.spring`, recorded so a test can check how a sheet settles. */
export const spring = vi.fn(() => ({ start: vi.fn() }));

/**
 * An animation the stand-ins hand back: it never runs, so no value moves and a rendered test
 * never depends on timing. A test checks what was started and stopped, and with what config.
 */
export interface StandInAnimation {
  kind: 'timing' | 'loop';
  value?: unknown;
  config?: Record<string, unknown>;
  animation?: StandInAnimation;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
const animation = (fields: Omit<StandInAnimation, 'start' | 'stop'>): StandInAnimation => ({
  ...fields,
  start: vi.fn(),
  stop: vi.fn(),
});
/** `Animated.timing`, recorded with its value and config. */
export const timing = vi.fn((value: unknown, config: Record<string, unknown>) =>
  animation({ kind: 'timing', value, config }),
);
/** `Animated.loop`, recorded with the animation it repeats. */
export const loop = vi.fn((inner: StandInAnimation) =>
  animation({ kind: 'loop', animation: inner }),
);

/** `Animated.Value`: holds a number, and describes what is derived from it. */
class AnimatedValue {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setValue(value: number) {
    this.value = value;
  }
  interpolate(config: { inputRange: number[]; outputRange: (number | string)[] }) {
    return { interpolation: config, of: this };
  }
}

const spies = {
  sendAccessibilityEvent: vi.fn(),
  alert: vi.fn(),
  setColorScheme: vi.fn(),
  openURL: vi.fn(),
  share: vi.fn(),
};

function listen<Listener>(listeners: Listener[], listener: Listener) {
  listeners.push(listener);
  return {
    remove: () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

/** Puts every stand-in back to the file's defaults; `./setup.ts` runs it after each test. */
export function resetNative() {
  Object.assign(currentWindow, fileWindow);
  appStateListeners.length = 0;
  connectionListeners.length = 0;
  backListeners.length = 0;
  reduceMotionListeners.length = 0;
  reduceMotion = false;
  spring.mockClear();
  timing.mockClear();
  loop.mockClear();
  for (const spy of Object.values(spies)) spy.mockClear();
}

export const reactNative = {
  AccessibilityInfo: {
    sendAccessibilityEvent: spies.sendAccessibilityEvent,
    getRecommendedTimeoutMillis: async (timeout: number) => timeout,
    isReduceMotionEnabled: async () => reduceMotion,
    addEventListener: (_type: 'reduceMotionChanged', listener: (enabled: boolean) => void) =>
      listen(reduceMotionListeners, listener),
  },
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: spies.alert },
  Animated: {
    View: 'AnimatedView',
    // Not 'Text': only what a reader sees is text to a test.
    Text: 'AnimatedText',
    Value: AnimatedValue,
    multiply: (a: unknown, b: unknown) => ({ multiply: [a, b] }),
    spring,
    timing,
    loop,
  },
  // Easing curves are named, not run: no animation runs in a test.
  Easing: {
    bezier: (...points: number[]) => ({ bezier: points }),
    in: (easing: unknown) => ({ in: easing }),
    out: (easing: unknown) => ({ out: easing }),
    inOut: (easing: unknown) => ({ inOut: easing }),
    linear: 'linear',
    ease: 'ease',
    quad: 'quad',
    cubic: 'cubic',
    sin: 'sin',
  },
  AppState: {
    addEventListener: (_type: string, listener: (state: string) => void) =>
      listen(appStateListeners, listener),
  },
  Appearance: { setColorScheme: spies.setColorScheme },
  BackHandler: {
    addEventListener: (_type: string, listener: () => boolean) => listen(backListeners, listener),
  },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Linking: {
    addEventListener: () => ({ remove: () => undefined }),
    getInitialURL: async () => null,
    openURL: spies.openURL,
  },
  Modal: 'Modal',
  // Hands its config straight through as the handlers, so a test can drive a drag.
  PanResponder: { create: (config: object) => ({ panHandlers: config }) },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Share: { share: spies.share },
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ ...currentWindow }),
};

/** `@react-native-community/netinfo`: its listeners hear `emitConnection`. */
export const netInfo = {
  default: {
    addEventListener: (listener: (state: { isConnected: boolean | null }) => void) =>
      listen(connectionListeners, listener).remove,
  },
};

export const safeAreaContext = {
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView',
};

// An icon is a host 'Ionicons' node carrying its name and color. It has no `font` map, which the
// App spreads into `useFonts`; the App tests replace `expo-font`.
export const ionicons = { default: 'Ionicons' };
