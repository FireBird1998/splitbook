import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// The build configuration is the seam: Android discovers widgets from this manifest.
function application(enabled?: string) {
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
  return config._internal.modResults.android.manifest.manifest.application[0];
}
function receiver(enabled?: string) {
  return (application(enabled).receiver ?? []).find(
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

it('declares a system-bound font-change job only when widgets are enabled, without a configuration broadcast receiver', () => {
  for (const enabled of ['true', 'false']) {
    const app = application(enabled);
    const service = app.service?.find(
      (entry: { $: Record<string, string> }) => entry.$['android:name'] === '.widget.FontScaleJob',
    );
    expect(service?.$).toMatchObject({
      'android:permission': 'android.permission.BIND_JOB_SERVICE',
      'android:enabled': enabled,
    });
    const actions = (app.receiver ?? []).flatMap(
      (entry: { 'intent-filter'?: { action?: { $: Record<string, string> }[] }[] }) =>
        (entry['intent-filter'] ?? []).flatMap((filter) =>
          (filter.action ?? []).map((action) => action.$['android:name']),
        ),
    );
    expect(actions).not.toContain('android.intent.action.CONFIGURATION_CHANGED');
  }
}, 30_000);

it('keeps the Group receiver home-screen only, private and behind the unchanged switch', () => {
  for (const enabled of ['true', 'false']) {
    const group = application(enabled).receiver.find(
      (entry: { $: Record<string, string> }) => entry.$['android:name'] === '.widget.Group',
    );
    expect(group.$).toMatchObject({
      'android:label': 'Group',
      'android:enabled': enabled,
      'android:exported': 'false',
    });
  }
}, 30_000);
