import type { AuthEnv } from '@/lib/auth/create-auth';

// Refresh rotation rolls this lifetime forward. The extra day covers use of an
// access token after issuance; the live grant check still enforces 90 idle days.
export const MCP_REFRESH_TOKEN_SECONDS = 91 * 24 * 60 * 60;
export const MCP_IDLE_SECONDS = 90 * 24 * 60 * 60;

/** Production ignores test timeouts unless the deployment is explicitly staging. */
export function mcpIdleSeconds(env: AuthEnv): number {
  if (env.MCP_DEPLOYMENT !== 'staging' || env.MCP_IDLE_TIMEOUT_SECONDS === undefined)
    return MCP_IDLE_SECONDS;
  const seconds = Number(env.MCP_IDLE_TIMEOUT_SECONDS);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MCP_IDLE_SECONDS)
    throw new Error('MCP_IDLE_TIMEOUT_SECONDS must be an integer from 1 to 7776000');
  return seconds;
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
