import { describe, expect, it, vi } from 'vitest';
import {
  androidInvitationFilters,
  developmentConfig,
  mobileConfig,
  receiptScanEnabled,
} from './config';

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
  it('limits the receipt-scanning experiment to development and staging builds', () => {
    expect(receiptScanEnabled('development')).toBe(true);
    expect(receiptScanEnabled('staging')).toBe(true);
    for (const mode of ['production', '', undefined]) expect(receiptScanEnabled(mode)).toBe(false);
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

describe('Android invitation link configuration', () => {
  it('builds staging with the package published by its domain association', async () => {
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'staging');
    try {
      vi.resetModules();
      const { default: config } = await import('../app.config');
      expect(config.name).toBe('SplitBook Staging');
      expect(config.android.package).toBe('com.splitbook.app.staging');
      expect(config.scheme).toBe('splitbook-staging');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
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
