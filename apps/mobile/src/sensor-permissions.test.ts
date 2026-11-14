import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(['development', 'staging', 'production'])(
  'blocks step and high-rate sensor permissions in the %s build',
  async (mode) => {
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', mode);
    vi.resetModules();
    const { default: config } = await import('../app.config');
    expect(config.android.blockedPermissions).toEqual([
      'android.permission.ACTIVITY_RECOGNITION',
      'android.permission.HIGH_SAMPLING_RATE_SENSORS',
    ]);
  },
);
