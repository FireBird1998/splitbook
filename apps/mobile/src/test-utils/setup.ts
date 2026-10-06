import { afterEach, vi } from 'vitest';
import { focusManager, onlineManager } from '@tanstack/query-core';
import { resetNative } from './native';
import { followInjectedClock, releaseInjectedClock } from './query-clock';

// Every test file renders through the same native stand-ins; see `./native.ts`.
vi.mock('react-native', async () => (await import('./native')).reactNative);
vi.mock('react-native-safe-area-context', async () => (await import('./native')).safeAreaContext);
vi.mock('@expo/vector-icons/Ionicons', async () => (await import('./native')).ionicons);
vi.mock('@react-native-community/netinfo', async () => (await import('./native')).netInfo);

// A controller built with an injected clock moves TanStack Query's clock with it; see
// `./query-clock.ts`. Nothing else about the controller changes.
vi.mock('../data/mobile-controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/mobile-controller')>();
  return {
    ...actual,
    createMobileController: (...args: Parameters<typeof actual.createMobileController>) => {
      followInjectedClock(args[1]);
      return actual.createMobileController(...args);
    },
  };
});

afterEach(() => {
  resetNative();
  releaseInjectedClock();
  // TanStack's focus and online state are one each per process: every test starts focused and
  // online, with no connection listener.
  focusManager.setFocused(undefined);
  onlineManager.setEventListener(() => undefined);
  onlineManager.setOnline(true);
});
