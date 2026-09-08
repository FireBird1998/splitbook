import { describe, expect, it } from 'vitest';
import {
  isTestIdTokenOverrideEnabled,
  signTestIdToken,
  verifyTestIdToken,
} from '@/lib/auth/test-id-token';

const SECRET = 'playwright-id-token-secret';
const CLAIMS = { sub: 'approved-user', email: 'approved@example.com', name: 'Approved' };

describe('test ID tokens', () => {
  it('round-trips a token and exposes the Google-shaped claims', () => {
    const token = signTestIdToken(CLAIMS, SECRET);
    expect(verifyTestIdToken(token, SECRET)).toBe(true);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload).toMatchObject({
      iss: 'https://accounts.google.com',
      sub: 'approved-user',
      email: 'approved@example.com',
      email_verified: true,
      name: 'Approved',
    });
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a token signed under another secret', () => {
    expect(verifyTestIdToken(signTestIdToken(CLAIMS, 'other'), SECRET)).toBe(false);
  });

  it('rejects tampered payloads', () => {
    const [header, , signature] = signTestIdToken(CLAIMS, SECRET).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...CLAIMS, email: 'owner@example.com', exp: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyTestIdToken(`${header}.${forged}.${signature}`, SECRET)).toBe(false);
  });

  it('rejects expired tokens and malformed input', () => {
    const expired = signTestIdToken({ ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
    expect(verifyTestIdToken(expired, SECRET)).toBe(false);
    expect(verifyTestIdToken('not.a.jwt', SECRET)).toBe(false);
    expect(verifyTestIdToken('', SECRET)).toBe(false);
    expect(verifyTestIdToken(signTestIdToken(CLAIMS, SECRET), '')).toBe(false);
  });

  it('binds the nonce when the sign-in supplied one', () => {
    const token = signTestIdToken({ ...CLAIMS, nonce: 'n-1' }, SECRET);
    expect(verifyTestIdToken(token, SECRET, 'n-1')).toBe(true);
    expect(verifyTestIdToken(token, SECRET, 'n-2')).toBe(false);
    expect(verifyTestIdToken(signTestIdToken(CLAIMS, SECRET), SECRET, 'n-1')).toBe(false);
  });
});

describe('isTestIdTokenOverrideEnabled', () => {
  it('is off without a secret', () => {
    expect(isTestIdTokenOverrideEnabled({})).toBe(false);
    expect(isTestIdTokenOverrideEnabled({ AUTH_TEST_ID_TOKEN_SECRET: '' })).toBe(false);
    expect(
      isTestIdTokenOverrideEnabled({ ALLOW_TEST_ID_TOKEN: 'true', NODE_ENV: 'development' }),
    ).toBe(false);
  });

  it('is on outside production when the secret is set', () => {
    expect(isTestIdTokenOverrideEnabled({ AUTH_TEST_ID_TOKEN_SECRET: 's' })).toBe(true);
    expect(isTestIdTokenOverrideEnabled({ AUTH_TEST_ID_TOKEN_SECRET: 's', NODE_ENV: 'test' })).toBe(
      true,
    );
  });

  it('is refused under a production build unless explicitly allowed', () => {
    expect(
      isTestIdTokenOverrideEnabled({ AUTH_TEST_ID_TOKEN_SECRET: 's', NODE_ENV: 'production' }),
    ).toBe(false);
    expect(
      isTestIdTokenOverrideEnabled({
        AUTH_TEST_ID_TOKEN_SECRET: 's',
        NODE_ENV: 'production',
        ALLOW_TEST_ID_TOKEN: 'TRUE',
      }),
    ).toBe(false);
    expect(
      isTestIdTokenOverrideEnabled({
        AUTH_TEST_ID_TOKEN_SECRET: 's',
        NODE_ENV: 'production',
        ALLOW_TEST_ID_TOKEN: 'true',
      }),
    ).toBe(true);
  });
});
