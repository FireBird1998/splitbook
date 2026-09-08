import type { NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { resolveProxyResponse } from '@/lib/auth/proxy-rules';

/**
 * Route protection. Optimistic by design: `getSessionCookie` only proves a
 * Better Auth session cookie exists, which keeps this hop free of database
 * access. Expired or revoked sessions are rejected by `getAuthUser()` (API
 * routes answer 401) and by the authenticated layout (pages redirect).
 * The rules themselves live in src/lib/auth/proxy-rules.ts.
 */
export default function proxy(request: NextRequest) {
  return resolveProxyResponse({
    url: request.url,
    pathname: request.nextUrl.pathname,
    method: request.method,
    hasSessionCookie: getSessionCookie(request) !== null,
  });
}

export const config = {
  // Only this exact catalogue URL skips the proxy. Its server page rejects
  // production requests; no other /dev page or API gains an auth exception.
  matcher: ['/((?!dev/design-system/?$|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
