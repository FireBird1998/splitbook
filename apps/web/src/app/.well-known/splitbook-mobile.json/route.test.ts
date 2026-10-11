import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
afterEach(() => vi.unstubAllEnvs());
describe('mobile build handshake', () => {
  it.each(['staging', 'production'])(
    'publishes the explicitly configured %s marker',
    async (environment) => {
      vi.stubEnv('MOBILE_APP_ENV', environment);
      vi.stubEnv('AUTH_MODE', 'google');
      vi.stubEnv('AUTH_GOOGLE_ID', '123-test.apps.googleusercontent.com');
      vi.stubEnv('AUTH_TEST_ID_TOKEN_SECRET', '');
      vi.stubEnv('ALLOW_DEMO_AUTH', '');
      expect(GET().status).toBe(200);
      expect(await GET().json()).toEqual({
        environment,
        googleWebClientId: '123-test.apps.googleusercontent.com',
      });
    },
  );
  it.each([
    { MOBILE_APP_ENV: 'development' },
    { AUTH_MODE: 'demo' },
    { AUTH_TEST_ID_TOKEN_SECRET: 'fictional' },
    { ALLOW_DEMO_AUTH: 'true' },
    { AUTH_GOOGLE_ID: 'invalid' },
  ])('fails closed for unsafe configuration %j', async (override) => {
    for (const [key, value] of Object.entries({
      MOBILE_APP_ENV: 'production',
      AUTH_MODE: 'google',
      AUTH_GOOGLE_ID: '123-test.apps.googleusercontent.com',
      AUTH_TEST_ID_TOKEN_SECRET: '',
      ALLOW_DEMO_AUTH: '',
      ...override,
    }))
      vi.stubEnv(key, value);
    expect(GET().status).toBe(404);
    expect(await GET().json()).toEqual({});
  });
});
