import type { ExpoConfig } from 'expo/config';
import { AndroidConfig } from 'expo/config-plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';

// On Android 13–15, React Native 0.86 forwards Back to the app only when the manifest leaves
// predictive Back off (facebook/react-native#58407). Opted in, Back leaves the app from every
// screen.
async function buildConfig(mode: string) {
  vi.stubEnv('EXPO_PUBLIC_APP_ENV', mode);
  vi.resetModules();
  const { default: config } = await import('../app.config');
  return config as ExpoConfig;
}

/** A minimal generated manifest: the plugin only sets an attribute on its application tag. */
const generatedManifest = (): AndroidConfig.Manifest.AndroidManifest => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    queries: [],
    application: [{ $: { 'android:name': '.MainApplication' } }],
  },
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Android Back configuration', () => {
  it.each([
    ['development', 'com.splitbook.app.dev'],
    ['staging', 'com.splitbook.app.staging'],
    ['production', 'com.splitbook.app'],
  ])('keeps predictive Back off in the %s build', async (mode, androidPackage) => {
    const config = await buildConfig(mode);
    expect(config.android?.package).toBe(androidPackage);
    expect(config.android?.predictiveBackGestureEnabled).not.toBe(true);

    const manifest = AndroidConfig.PredictiveBackGesture.setPredictiveBackGesture(
      config,
      generatedManifest(),
    );
    expect(
      AndroidConfig.Manifest.getMainApplicationOrThrow(manifest).$[
        'android:enableOnBackInvokedCallback'
      ],
    ).toBe('false');
  });
});
