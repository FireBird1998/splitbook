import type { AuthEnv } from '@/lib/auth/create-auth';

// Refresh rotation rolls this lifetime forward. The extra day covers use of an
// access token after issuance; the live grant check still enforces 90 idle days.
export const MCP_REFRESH_TOKEN_SECONDS = 91 * 24 * 60 * 60;
export const MCP_IDLE_SECONDS = 90 * 24 * 60 * 60;

/** Staging alone may shorten inactivity; the production deployment always keeps 90 days. */
export function mcpIdleSeconds(env: AuthEnv): number {
  if (
    env.MOBILE_APP_ENV === 'production' ||
    env.MCP_DEPLOYMENT !== 'staging' ||
    !env.MCP_IDLE_TIMEOUT_SECONDS?.trim()
  )
    return MCP_IDLE_SECONDS;
  const seconds = Number(env.MCP_IDLE_TIMEOUT_SECONDS);
  if (!Number.isInteger(seconds) || seconds < 120 || seconds > MCP_IDLE_SECONDS)
    throw new Error('MCP_IDLE_TIMEOUT_SECONDS must be an integer from 120 to 7776000');
  return seconds;
}

let loggedInvalidTimeout = false;

/** Validate on auth initialization without disabling the app's own sign-in/session routes. */
export function mcpUnavailable(env: AuthEnv = process.env): boolean {
  if (env.MCP_ENABLED !== 'true') return false;
  try {
    mcpIdleSeconds(env);
    return false;
  } catch {
    if (!loggedInvalidTimeout) {
      console.error(
        'Invalid MCP inactivity configuration: MCP_IDLE_TIMEOUT_SECONDS must be an integer from 120 to 7776000. MCP is unavailable (503); normal sign-in and pages remain available.',
      );
      loggedInvalidTimeout = true;
    }
    return true;
  }
}

/** Shared by MCP, its OAuth routes and discovery; never intercept ordinary app routes. */
export function mcpUnavailableResponse(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  const isMcp =
    path === '/api/mcp' ||
    path.startsWith('/api/auth/mcp/') ||
    path.startsWith('/api/auth/oauth2/') ||
    path === '/api/auth/jwks' ||
    path.startsWith('/.well-known/oauth-') ||
    path.startsWith('/api/auth/.well-known/oauth-') ||
    path === '/api/auth/.well-known/openid-configuration';
  return isMcp && mcpUnavailable()
    ? Response.json(
        { error: 'MCP_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    : null;
}

export const MCP_LEDGER_SCOPE = 'ledger:read';
export const MCP_DRAFT_SCOPE = 'drafts:write';
export const MCP_SCOPES = [MCP_LEDGER_SCOPE, MCP_DRAFT_SCOPE, 'offline_access'];

export function mcpResource(env: AuthEnv = process.env): string | null {
  if (env.MCP_ENABLED !== 'true') return null;
  if (!env.NEXT_PUBLIC_APP_URL) throw new Error('MCP requires NEXT_PUBLIC_APP_URL');
  const url = new URL(env.NEXT_PUBLIC_APP_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && loopback && env.NODE_ENV !== 'production')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'MCP requires a canonical HTTPS app origin (HTTP loopback is development-only)',
    );
  }
  const resource = new URL(env.MCP_RESOURCE_URL || `${url.origin}/api/mcp`);
  const localResource = ['localhost', '127.0.0.1', '[::1]'].includes(resource.hostname);
  if (
    (resource.protocol !== 'https:' &&
      !(resource.protocol === 'http:' && localResource && env.NODE_ENV !== 'production')) ||
    resource.username ||
    resource.password ||
    resource.search ||
    resource.hash ||
    resource.pathname !== '/api/mcp'
  ) {
    throw new Error('MCP_RESOURCE_URL must be a canonical HTTPS URL ending in /api/mcp');
  }
  return resource.href;
}
