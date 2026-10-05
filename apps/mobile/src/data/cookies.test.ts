import { describe, expect, it } from 'vitest';
import {
  decodeStoredSession,
  encodeStoredSession,
  readSessionCookie,
  validSessionCookie,
} from './cookies';

const now = Date.parse('2026-09-27T10:00:00.000Z');

describe('signed session cookie boundary', () => {
  it('extracts only the token from a combined header containing an Expires comma and cache cookies', () => {
    const headers = {
      get: () =>
        'better-auth.session_data=cache; Expires=Wed, 01 Jan 2030 00:00:00 GMT, better-auth.session_token=signed%2Btoken.signature; Path=/; HttpOnly, tracking=ignore; Path=/',
    };
    expect(readSessionCookie(headers, false, now)).toBe(
      'better-auth.session_token=signed%2Btoken.signature',
    );
  });

  it('reads separate native headers, accepts secure prefixes only over HTTPS, and drops expired tokens', () => {
    const headers = {
      get: () => null,
      getSetCookie: () => [
        'other=ignore',
        '__Secure-better-auth.session_token=value.signature; Secure; HttpOnly; Max-Age=300',
      ],
    };
    expect(readSessionCookie(headers, true, now)).toBe(
      '__Secure-better-auth.session_token=value.signature',
    );
    expect(() => readSessionCookie(headers, false, now)).toThrow();
    expect(
      readSessionCookie(
        { get: () => 'better-auth.session_token=old; Expires=Wed, 01 Jan 2020 00:00:00 GMT' },
        false,
        now,
      ),
    ).toBeNull();
  });

  it('uses Max-Age precedence and does not confuse unrelated cookie deletion with logout', () => {
    expect(
      readSessionCookie(
        {
          get: () =>
            'better-auth.session_token=valid; Max-Age=300; Expires=Wed, 01 Jan 2020 00:00:00 GMT',
        },
        false,
        now,
      ),
    ).toBe('better-auth.session_token=valid');
    expect(
      readSessionCookie({ get: () => 'better-auth.session_data=; Max-Age=0' }, false, now),
    ).toBeUndefined();
  });

  it('rejects persisted header attributes, extra cookie pairs, raw tokens, and control characters', () => {
    for (const candidate of [
      'raw-token',
      'better-auth.session_token=valid; Path=/',
      'better-auth.session_token=valid; other=secret',
      'better-auth.session_token=bad\r\nOrigin: attacker',
    ]) {
      expect(validSessionCookie(candidate, false)).toBe(false);
    }
  });
});

describe('the saved session and the account it was verified for (#200)', () => {
  const cookie = 'better-auth.session_token=signed.signature';
  const accountId = 'a00000000000000000000001';

  it('reads an unverified cookie, as every earlier version saved it, and a verified one', () => {
    expect(encodeStoredSession(cookie, null)).toBe(cookie);
    expect(decodeStoredSession(cookie, false)).toEqual({ cookie, accountId: null });
    expect(decodeStoredSession(encodeStoredSession(cookie, accountId), false)).toEqual({
      cookie,
      accountId,
    });
  });

  it('refuses anything that is not a usable saved session', () => {
    for (const candidate of [
      'raw-token',
      '{',
      JSON.stringify({ cookie }),
      JSON.stringify({ cookie, accountId: '' }),
      JSON.stringify({ cookie, accountId: null }),
      JSON.stringify({ cookie, accountId, extra: true }),
      JSON.stringify({ cookie: 'better-auth.session_token=valid; Path=/', accountId }),
      JSON.stringify({ cookie: `__Secure-${cookie}`, accountId }),
    ]) {
      expect(decodeStoredSession(candidate, false)).toBeNull();
    }
    expect(decodeStoredSession(encodeStoredSession(`__Secure-${cookie}`, accountId), true)).toEqual(
      { cookie: `__Secure-${cookie}`, accountId },
    );
  });
});
