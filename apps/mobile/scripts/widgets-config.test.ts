import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// The build configuration is the seam: Android discovers widgets from this manifest.
function receiver(enabled?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_APP_ENV: 'development',
  };
  if (enabled === undefined) delete env.EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED;
  else env.EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED = enabled;
  const config = JSON.parse(
    execFileSync(
      process.execPath,
      [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'],
      {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
  const receivers =
    config._internal.modResults.android.manifest.manifest.application[0].receiver ?? [];
  return receivers.find(
    (entry: { $: Record<string, string> }) => entry.$['android:name'] === '.widget.Balances',
  );
}

describe('Android Balances widget discovery', () => {
  it('offers Balances only in builds explicitly enabling widgets', () => {
    expect(receiver('true')?.$).toMatchObject({
      'android:enabled': 'true',
      'android:label': 'Balances',
    });
    expect(receiver()?.$['android:enabled']).toBe('false');
    expect(receiver('false')?.$['android:enabled']).toBe('false');
  }, 30_000);
});
