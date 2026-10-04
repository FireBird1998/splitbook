import { afterEach, vi } from 'vitest';
import { resetNative } from './native';

// Every test file renders through the same native stand-ins; see `./native.ts`.
vi.mock('react-native', async () => (await import('./native')).reactNative);
vi.mock('react-native-safe-area-context', async () => (await import('./native')).safeAreaContext);
vi.mock('@expo/vector-icons/Ionicons', async () => (await import('./native')).ionicons);

afterEach(resetNative);
