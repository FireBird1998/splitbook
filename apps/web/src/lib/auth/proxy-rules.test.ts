import { describe, expect, it } from 'vitest';
import { resolveProxyResponse } from '@/lib/auth/proxy-rules';

const ORIGIN = 'http://localhost:3100';

function decide(pathname: string, hasSessionCookie: boolean, method = 'GET') {
  return resolveProxyResponse({
    url: `${ORIGIN}${pathname}`,
    pathname: pathname.split('?')[0],
    method,
    hasSessionCookie,
  });
}

/** `NextResponse.next()` carries the middleware pass-through header. */
function passesThrough(response: Response): boolean {
  return response.headers.has('x-middleware-next');
}

describe('proxy rules', () => {
  it('always allows Better Auth routes (including the Google callback)', () => {
    expect(passesThrough(decide('/api/auth/callback/google', false))).toBe(true);
    expect(passesThrough(decide('/api/auth/get-session', true))).toBe(true);
    expect(passesThrough(decide('/api/auth/sign-in/social', false, 'POST'))).toBe(true);
  });

  it('lets login validate a session cookie before deciding whether to redirect', () => {
    expect(passesThrough(decide('/login', true))).toBe(true);
  });

  it('allows public pages for anonymous visitors', () => {
    expect(passesThrough(decide('/', false))).toBe(true);
    expect(passesThrough(decide('/join/ABC123', false))).toBe(true);
    expect(passesThrough(decide('/login', false))).toBe(true);
    expect(passesThrough(decide('/login?callbackUrl=%2Fdashboard', false))).toBe(true);
  });

  it('rejects anonymous API calls with 401 JSON instead of a redirect', async () => {
    const response = decide('/api/groups', false);
    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized', status: 401 });
  });

  it('allows anonymous GET invite previews so the join page can render', () => {
    expect(passesThrough(decide('/api/join/ABC123', false))).toBe(true);
  });

  it('rejects anonymous join POSTs (joining requires a session)', () => {
    expect(decide('/api/join/ABC123', false, 'POST').status).toBe(401);
  });

  it('redirects anonymous page visits to /login with callbackUrl', () => {
    const response = decide('/groups/abc/settings', false);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') as string);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('callbackUrl')).toBe('/groups/abc/settings');
  });

  it('lets requests with a session cookie through to pages and APIs', () => {
    expect(passesThrough(decide('/dashboard', true))).toBe(true);
    expect(passesThrough(decide('/api/groups', true))).toBe(true);
    expect(passesThrough(decide('/api/join/ABC123', true, 'POST'))).toBe(true);
  });
});
