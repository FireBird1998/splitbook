/**
 * Route-protection rules applied by `src/proxy.ts`. Edge-safe and pure so the
 * decision table can be unit tested without a request pipeline.
 *
 * The proxy only knows whether a session cookie is present (Better Auth's
 * optimistic check). Expired or revoked sessions get past it and are rejected
 * where validation lives: `getAuthUser()` answers 401 for API routes and the
 * authenticated layout redirects for pages.
 */

import { NextResponse } from 'next/server';

export interface ProxyDecisionInput {
  /** Absolute request URL; used to build same-origin redirects. */
  url: string;
  pathname: string;
  method: string;
  hasSessionCookie: boolean;
}

export const UNAUTHORIZED_BODY = { error: 'Unauthorized', status: 401 } as const;

export function resolveProxyResponse({
  url,
  pathname,
  method,
  hasSessionCookie,
}: ProxyDecisionInput): NextResponse {
  const isAuthPage = pathname.startsWith('/login');
  const isPublicPage = pathname === '/' || pathname.startsWith('/join');
  const isApiAuth = pathname.startsWith('/api/auth');
  // GET /api/join/[code] is intentionally auth-free (invite preview); POST joins and stays protected
  const isJoinPreview = pathname.startsWith('/api/join/') && method === 'GET';
  const isApi = pathname.startsWith('/api');

  // 1. Better Auth's own routes (sign-in, callback, session, sign-out) are always reachable.
  if (isApiAuth) return NextResponse.next();

  // 2. Allow the public invite-preview read so the join page can render its sign-in CTA.
  if (isJoinPreview) return NextResponse.next();

  // 3. Login validates the session itself before redirecting. Cookie presence
  //    alone can also mean an expired or invalid session and cause a loop.
  if (isPublicPage || isAuthPage) return NextResponse.next();

  // 4. Anonymous API calls get the same 401 JSON shape the route helpers use
  //    (see api-response.ts); API clients cannot follow a redirect.
  if (isApi && !hasSessionCookie) {
    return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 });
  }

  // 5. Every other anonymous page visit goes to sign-in, remembering where it was headed.
  if (!hasSessionCookie) {
    const loginUrl = new URL('/login', url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
