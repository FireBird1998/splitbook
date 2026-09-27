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
