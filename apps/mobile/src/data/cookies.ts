import { z } from 'zod';
import type { CookieHeaders } from './types';

const sessionName = /^(?:__Secure-|__Host-)?better-auth\.session_token$/;
const cookieValue = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

/** A persisted cookie is one name/value pair, never an entire Set-Cookie header. */
export function validSessionCookie(value: string, secureTransport: boolean): boolean {
  const separator = value.indexOf('=');
  if (separator < 0) return false;
  const name = value.slice(0, separator);
  return (
    sessionName.test(name) &&
    cookieValue.test(value.slice(separator + 1)) &&
    (secureTransport || !name.startsWith('__'))
  );
}

/**
 * The saved session: the signed cookie, and the account a session check confirmed it belongs to.
 * A cookie from a sign-in reply, and every cookie saved before accounts were recorded, is
 * unverified (`accountId` null) until `get-session` confirms its account.
 */
export interface StoredSession {
  cookie: string;
  accountId: string | null;
}

const verifiedSession = z.object({ cookie: z.string(), accountId: z.string().min(1) }).strict();

/** An unverified cookie is stored as the cookie alone, as every earlier version stored it. */
export function encodeStoredSession(cookie: string, accountId: string | null): string {
  return accountId === null ? cookie : JSON.stringify({ cookie, accountId });
}

/** Null for anything that is not a usable saved session. */
export function decodeStoredSession(value: string, secureTransport: boolean): StoredSession | null {
  if (!value.startsWith('{'))
    return validSessionCookie(value, secureTransport) ? { cookie: value, accountId: null } : null;
  try {
    const stored = verifiedSession.parse(JSON.parse(value));
    return validSessionCookie(stored.cookie, secureTransport) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Read only Better Auth's signed session token. Expires contains commas, so a
 * combined header must split at the next cookie-name assignment, not every comma.
 * Undefined means no change; null is an explicit expiry/deletion.
 */
export function readSessionCookie(
  headers: CookieHeaders,
  secureTransport: boolean,
  now: number,
): string | null | undefined {
  const separate = headers.getSetCookie?.();
  const raw = separate?.length ? separate : [headers.get('set-cookie') ?? ''];
  let result: string | null | undefined;
  for (const combined of raw) {
    for (const header of combined.split(/,(?=\s*[^\s;,=]+\s*=)/)) {
      const [pair, ...attributes] = header.trim().split(';');
      const separator = pair.indexOf('=');
      if (separator < 0 || !sessionName.test(pair.slice(0, separator))) continue;
      const cookie = pair.trim();
      const parsed = new Map(
        attributes.map((attribute) => {
          const [name, ...parts] = attribute.trim().split('=');
          return [name.toLowerCase(), parts.join('=')];
        }),
      );
      const maxAge = parsed.get('max-age');
      const expires = parsed.get('expires');
      const expired =
        maxAge !== undefined && /^-?\d+$/.test(maxAge)
          ? Number(maxAge) <= 0
          : expires !== undefined && Date.parse(expires) <= now;
      if (pair.slice(separator + 1) === '' || expired) {
        result = null;
        continue;
      }
      if (
        !validSessionCookie(cookie, secureTransport) ||
        (!secureTransport && parsed.has('secure'))
      ) {
        throw new Error('Invalid session cookie');
      }
      result = cookie;
    }
  }
  return result;
}
