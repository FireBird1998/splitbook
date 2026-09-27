import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const fingerprint = Array.from({ length: 32 }, () => 'AB').join(':');

afterEach(() => vi.unstubAllEnvs());

describe('GET /.well-known/assetlinks.json', () => {
  it('publishes only the fixed staging app association after explicit operator opt-in', async () => {
    vi.stubEnv('ANDROID_APP_LINKS_ENV', 'staging');
    vi.stubEnv('ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS', fingerprint);

    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('location')).toBeNull();
    await expect(response.json()).resolves.toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.splitbook.app.staging',
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ]);
  });
  it('publishes no association without the exact staging opt-in', async () => {
    vi.stubEnv('ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS', fingerprint);
    for (const mode of [undefined, '', 'development', 'production', 'STAGING']) {
      vi.stubEnv('ANDROID_APP_LINKS_ENV', mode);
      const response = GET();
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual([]);
    }
  });
  it('fails closed for missing or malformed signing fingerprints', async () => {
    vi.stubEnv('ANDROID_APP_LINKS_ENV', 'staging');
    for (const value of [
      undefined,
      '',
      '   ',
      'AB:CD',
      'AB'.repeat(32),
      fingerprint.replace('AB', 'ZZ'),
      `${fingerprint},invalid`,
    ]) {
      vi.stubEnv('ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS', value);
      const response = GET();
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual([]);
    }
  });
  it('publishes normalized comma-separated fingerprints for signing certificate rotation', async () => {
    const rotated = Array.from({ length: 32 }, () => 'CD').join(':');
    vi.stubEnv('ANDROID_APP_LINKS_ENV', 'staging');
    vi.stubEnv(
      'ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS',
      ` ${fingerprint.toLowerCase()}, ${rotated} `,
    );
    const response = GET();
    expect(response.status).toBe(200);
    expect((await response.json())[0].target.sha256_cert_fingerprints).toEqual([
      fingerprint,
      rotated,
    ]);
  });
});
