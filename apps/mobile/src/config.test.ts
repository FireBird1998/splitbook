import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { androidInvitationFilters, developmentConfig, mobileConfig } from './config';

const local = {
  mode: 'development',
  apiUrl: 'http://127.0.0.1:4138',
  authOrigin: 'http://127.0.0.1:4138',
};
describe('development build configuration', () => {
  it('requires both a development binary and explicit development mode', () => {
    expect(developmentConfig(local, true)?.developmentPersonaEnabled).toBe(true);
    expect(developmentConfig(local, false)).toBeNull();
    expect(developmentConfig({ ...local, mode: 'staging' }, true)).toBeNull();
    expect(developmentConfig({}, true)).toBeNull();
  });
  it('uses the explicit invitation origin or the configured auth origin as its fallback', () => {
    expect(developmentConfig(local, true)?.inviteOrigin).toBe('http://127.0.0.1:4138');
    expect(
      developmentConfig({ ...local, inviteOrigin: 'https://staging.splitbook.test' }, true)
        ?.inviteOrigin,
    ).toBe('https://staging.splitbook.test');
  });
  it('rejects an invalid explicitly configured invitation origin', () => {
    for (const inviteOrigin of [
      '',
      'file:///tmp/data',
      'https://example.com/join',
      'https://user:secret@example.com',
      'https://example.com/?redirect=other',
      'https://example.com/#other',
    ]) {
      expect(developmentConfig({ ...local, inviteOrigin }, true)).toBeNull();
    }
  });
  it.each([
    'not a URL',
    'file:///tmp/data',
    'https://example.com/api',
    'https://user:password@example.com',
    'https://example.com/?token=private',
  ])('fails closed for invalid origin %s', (apiUrl) => {
    expect(developmentConfig({ ...local, apiUrl }, true)).toBeNull();
  });
});

describe('native app configuration per environment', () => {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const brand = JSON.parse(
    readFileSync(resolve(appRoot, '../../assets/brand/brand.json'), 'utf8'),
  ) as { colors: Record<'ink' | 'paper', string> };
  async function loadAppConfig(mode: string, authOrigin: string) {
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', mode);
    vi.stubEnv('EXPO_PUBLIC_AUTH_ORIGIN', authOrigin);
    vi.stubEnv('EXPO_PUBLIC_INVITE_ORIGIN', authOrigin);
    try {
      vi.resetModules();
      return (await import('../app.config')).default;
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  }
  const invitationFilter = (scheme: string, host: string, autoVerify: boolean, port?: string) => ({
    action: 'VIEW',
    autoVerify,
    data: [{ scheme, host, ...(port ? { port } : {}), pathPrefix: '/join/' }],
    category: ['BROWSABLE', 'DEFAULT'],
  });
  it.each([
    {
      mode: 'development',
      origin: 'http://127.0.0.1:4138',
      name: 'SplitBook Dev',
      identifier: 'com.splitbook.app.dev',
      scheme: 'splitbook-dev',
      intentFilters: [invitationFilter('http', '127.0.0.1', false, '4138')],
    },
    {
      mode: 'staging',
      origin: 'https://staging.splitbook.test',
      name: 'SplitBook Staging',
      identifier: 'com.splitbook.app.staging',
      scheme: 'splitbook-staging',
      intentFilters: [invitationFilter('https', 'staging.splitbook.test', true)],
    },
    {
      mode: 'production',
      origin: 'https://splitbook.test',
      name: 'SplitBook',
      identifier: 'com.splitbook.app',
      scheme: 'splitbook',
      intentFilters: [],
    },
  ])(
    'keeps the $mode identity and shows the brand icon and splash',
    async ({ mode, origin, name, identifier, scheme, intentFilters }) => {
      const config = await loadAppConfig(mode, origin);
      expect(config).toMatchObject({
        name,
        scheme,
        ios: { bundleIdentifier: identifier },
        android: { package: identifier, intentFilters },
      });
      expect(config.plugins).toEqual(
        expect.arrayContaining([
          'expo-secure-store',
          'expo-font',
          ['expo-build-properties', { android: { usesCleartextTraffic: mode === 'development' } }],
        ]),
      );
      expect(config.icon).toBe('./assets/brand/app-icon.png');
      expect(config.android.adaptiveIcon).toEqual({
        foregroundImage: './assets/brand/android-foreground.png',
        monochromeImage: './assets/brand/android-monochrome.png',
        backgroundColor: brand.colors.ink,
      });
      expect(config.plugins).toContainEqual([
        'expo-splash-screen',
        {
          image: './assets/brand/splash-light.png',
          imageWidth: 288,
          backgroundColor: brand.colors.paper,
          dark: { image: './assets/brand/splash-dark.png', backgroundColor: brand.colors.ink },
        },
      ]);
    },
  );
  it('names brand files that exist, with each splash image covering the whole splash icon', async () => {
    const config = await loadAppConfig('production', 'https://splitbook.test');
    const splash = config.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    )?.[1] as { image: string; imageWidth: number; dark: { image: string } };
    const { foregroundImage, monochromeImage } = config.android.adaptiveIcon;
    for (const file of [config.icon, foregroundImage, monochromeImage])
      expect(existsSync(resolve(appRoot, file)), file).toBe(true);
    // Android draws the splash icon on a 288 dp canvas; 4x pixels keep xxxhdpi from upscaling.
    for (const file of [splash.image, splash.dark.image]) {
      const png = readFileSync(resolve(appRoot, file));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([
        splash.imageWidth * 4,
        splash.imageWidth * 4,
      ]);
    }
  });
});

describe('Android invitation link configuration', () => {
  it('registers the exact development host and port for web invitation paths', () => {
    expect(androidInvitationFilters(local)).toEqual([
      {
        action: 'VIEW',
        autoVerify: false,
        data: [{ scheme: 'http', host: '127.0.0.1', port: '4138', pathPrefix: '/join/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
  });
  it('registers an explicitly configured HTTPS staging origin for domain verification', () => {
    expect(
      androidInvitationFilters({
        ...local,
        mode: 'staging',
        inviteOrigin: 'https://staging.splitbook.test',
      }),
    ).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'staging.splitbook.test', pathPrefix: '/join/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
  });
  it('omits Android link registration for unsupported modes, insecure staging, or invalid origins', () => {
    for (const env of [
      {},
      { ...local, mode: undefined },
      { ...local, mode: 'production', inviteOrigin: 'https://splitbook.test' },
      { ...local, mode: 'staging' },
      { ...local, inviteOrigin: '' },
      { ...local, inviteOrigin: 'file:///tmp/data' },
      { ...local, inviteOrigin: 'https://user:secret@example.com' },
      { ...local, inviteOrigin: 'https://example.com/join' },
      { ...local, inviteOrigin: 'https://example.com/?redirect=other' },
      { ...local, inviteOrigin: 'https://example.com/#other' },
    ])
      expect(androidInvitationFilters(env)).toEqual([]);
  });
});

describe('staging Google build configuration', () => {
  const staging = {
    mode: 'staging',
    apiUrl: 'https://staging.splitbook.test',
    authOrigin: 'https://staging.splitbook.test',
    googleWebClientId: '123-test.apps.googleusercontent.com',
  };
  it('enables real sessions in signed builds without enabling demo personas', () => {
    for (const developmentBuild of [false, true]) {
      expect(mobileConfig(staging, developmentBuild)).toMatchObject({
        developmentPersonaEnabled: false,
        googleWebClientId: staging.googleWebClientId,
        inviteOrigin: staging.authOrigin,
      });
    }
    expect(mobileConfig(local, true)?.developmentPersonaEnabled).toBe(true);
    expect(mobileConfig(local, false)).toBeNull();
  });
  it('fails closed for incomplete, insecure, cross-server, or unsupported settings', () => {
    for (const overrides of [
      { mode: undefined },
      { mode: 'production' },
      { apiUrl: '' },
      { apiUrl: 'http://staging.splitbook.test' },
      { authOrigin: 'https://different.test' },
      { inviteOrigin: 'http://staging.splitbook.test' },
      { googleWebClientId: '' },
      { googleWebClientId: 'not-a-client-id' },
    ])
      expect(mobileConfig({ ...staging, ...overrides }, false)).toBeNull();
  });
});
