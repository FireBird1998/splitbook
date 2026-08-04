import { describe, expect, it } from 'vitest';
import { isDemoAuthAllowed, isDemoMode, resolveAuthMode } from '@/lib/auth-mode';

describe('resolveAuthMode', () => {
  it('defaults to google when AUTH_MODE is unset', () => {
    expect(resolveAuthMode({})).toBe('google');
    expect(resolveAuthMode({ AUTH_MODE: '' })).toBe('google');
    expect(resolveAuthMode({ AUTH_MODE: 'google' })).toBe('google');
  });

  it('uses demo when AUTH_MODE=demo in development', () => {
    expect(
      resolveAuthMode({ AUTH_MODE: 'demo', NODE_ENV: 'development' }),
    ).toBe('demo');
    expect(isDemoMode({ AUTH_MODE: 'demo', NODE_ENV: 'test' })).toBe(true);
  });

  it('fails closed in production without ALLOW_DEMO_AUTH', () => {
    expect(
      resolveAuthMode({ AUTH_MODE: 'demo', NODE_ENV: 'production' }),
    ).toBe('google');
    expect(
      isDemoAuthAllowed({ AUTH_MODE: 'demo', NODE_ENV: 'production' }),
    ).toBe(false);
  });

  it('allows demo in production only with explicit override', () => {
    expect(
      resolveAuthMode({
        AUTH_MODE: 'demo',
        NODE_ENV: 'production',
        ALLOW_DEMO_AUTH: 'true',
      }),
    ).toBe('demo');
    expect(
      isDemoAuthAllowed({
        AUTH_MODE: 'demo',
        NODE_ENV: 'production',
        ALLOW_DEMO_AUTH: '1',
      }),
    ).toBe(false);
  });

  it('requires exact, case-sensitive env values (fail closed on lookalikes)', () => {
    // AUTH_MODE must be exactly 'demo'
    expect(isDemoAuthAllowed({ AUTH_MODE: 'Demo', NODE_ENV: 'development' })).toBe(false);
    expect(isDemoAuthAllowed({ AUTH_MODE: 'DEMO', NODE_ENV: 'development' })).toBe(false);
    expect(isDemoAuthAllowed({ AUTH_MODE: ' demo', NODE_ENV: 'development' })).toBe(false);
    expect(isDemoAuthAllowed({ AUTH_MODE: 'demo ', NODE_ENV: 'development' })).toBe(false);

    // ALLOW_DEMO_AUTH must be exactly 'true'
    expect(
      isDemoAuthAllowed({
        AUTH_MODE: 'demo',
        NODE_ENV: 'production',
        ALLOW_DEMO_AUTH: 'TRUE',
      }),
    ).toBe(false);
    expect(
      isDemoAuthAllowed({
        AUTH_MODE: 'demo',
        NODE_ENV: 'production',
        ALLOW_DEMO_AUTH: 'yes',
      }),
    ).toBe(false);
  });

  it('treats non-production NODE_ENV values as development', () => {
    expect(isDemoAuthAllowed({ AUTH_MODE: 'demo' })).toBe(true);
    expect(isDemoAuthAllowed({ AUTH_MODE: 'demo', NODE_ENV: 'test' })).toBe(true);
    expect(isDemoMode({ AUTH_MODE: 'demo', NODE_ENV: 'staging' })).toBe(true);
  });
});
