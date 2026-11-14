import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

// The build configuration is the seam: Android discovers widgets from this manifest.
function configuration(enabled?: string) {
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
  return config._internal.modResults.android.manifest.manifest;
}
function application(enabled?: string) {
  return configuration(enabled).application[0];
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
      'android:label': 'Overview',
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

it('enables the midnight job and clock/zone/boot receiver with the widget switch', () => {
  for (const enabled of ['true', 'false']) {
    const app = application(enabled);
    expect(
      app.service.find(
        (s: { $: Record<string, string> }) => s.$['android:name'] === '.widget.DateChangeJob',
      ).$,
    ).toMatchObject({
      'android:permission': 'android.permission.BIND_JOB_SERVICE',
      'android:enabled': enabled,
    });
    const receiver = app.receiver.find(
      (r: { $: Record<string, string> }) => r.$['android:name'] === '.widget.ClockChangeReceiver',
    );
    expect(receiver.$).toMatchObject({ 'android:enabled': enabled, 'android:exported': 'false' });
    expect(
      receiver['intent-filter'][0].action.map(
        (a: { $: Record<string, string> }) => a.$['android:name'],
      ),
    ).toEqual([
      'android.intent.action.TIME_SET',
      'android.intent.action.TIMEZONE_CHANGED',
      'android.intent.action.BOOT_COMPLETED',
    ]);
  }
}, 30_000);

it('declares boot reception only in widgets-on builds', () => {
  for (const enabled of ['true', 'false', undefined]) {
    const manifest = configuration(enabled);
    const permission = (manifest['uses-permission'] ?? []).find(
      (p: { $: Record<string, string> }) =>
        p.$['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED',
    );
    if (enabled === 'true') {
      expect(permission?.$['tools:node']).toBeUndefined();
      expect(permission?.$['android:name']).toBe('android.permission.RECEIVE_BOOT_COMPLETED');
    } else {
      expect(permission?.$['tools:node']).toBe('remove');
      expect(manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    }
  }
}, 30_000);

it('keeps broadcast redraws inside a one-shot job and lets placement restore the build-controlled receiver state', () => {
  const job = readFileSync('plugins/android-widgets/DateChangeJob.java', 'utf8');
  const receiver = readFileSync('plugins/android-widgets/ClockChangeReceiver.java', 'utf8');
  const changed = job.slice(
    job.indexOf('public static void changed'),
    job.indexOf('@Override public boolean onStartJob'),
  );
  expect(receiver).toContain('DateChangeJob.changed(context)');
  expect(receiver).not.toContain('RNWidgetJsCommunication');
  expect(changed).toContain('IMMEDIATE_JOB_ID');
  expect(changed).toContain('.setMinimumLatency(1)');
  expect(changed).not.toContain('RNWidgetJsCommunication');
  const running = job.slice(job.indexOf('@Override public boolean onStartJob'));
  expect(running).toContain('RNWidgetJsCommunication.requestWidgetUpdate');
  expect(running).not.toContain('changed(this)');
  expect(job).toContain('jobs.cancel(IMMEDIATE_JOB_ID)');
  expect(job).toContain('placed ? PackageManager.COMPONENT_ENABLED_STATE_DEFAULT');
  expect(job).toContain('PackageManager.COMPONENT_ENABLED_STATE_DISABLED');
  expect(job).not.toContain('COMPONENT_ENABLED_STATE_ENABLED');
});

it('offers Person as the fourth private receiver behind the same switch', () => {
  for (const enabled of ['true', 'false']) {
    const widgets = application(enabled).receiver.filter((entry: { $: Record<string, string> }) =>
      ['.widget.Balances', '.widget.Group', '.widget.Quick', '.widget.Person'].includes(
        entry.$['android:name'],
      ),
    );
    expect(widgets).toHaveLength(4);
    expect(
      widgets.find(
        (entry: { $: Record<string, string> }) => entry.$['android:name'] === '.widget.Person',
      )?.$,
    ).toMatchObject({
      'android:label': 'Person',
      'android:enabled': enabled,
      'android:exported': 'false',
    });
  }
}, 30000);
