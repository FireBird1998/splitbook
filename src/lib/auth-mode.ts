/**
 * Edge-safe auth mode resolution.
 * Must not import Node-only modules (mongodb, mongoose, etc.).
 */

export type AuthMode = 'demo' | 'google';

export interface AuthModeEnv {
  AUTH_MODE?: string;
  NODE_ENV?: string;
  ALLOW_DEMO_AUTH?: string;
}

/**
 * Whether demo authentication is allowed under the current environment.
 * Fail closed: in production, demo requires an explicit ALLOW_DEMO_AUTH=true override.
 */
export function isDemoAuthAllowed(env: AuthModeEnv = process.env): boolean {
  if (env.AUTH_MODE !== 'demo') return false;
  if (env.NODE_ENV === 'production' && env.ALLOW_DEMO_AUTH !== 'true') {
    return false;
  }
  return true;
}

/**
 * Resolved auth mode for providers and UI.
 * Defaults to google when AUTH_MODE is unset or demo is blocked.
 */
export function resolveAuthMode(env: AuthModeEnv = process.env): AuthMode {
  return isDemoAuthAllowed(env) ? 'demo' : 'google';
}

export function isDemoMode(env: AuthModeEnv = process.env): boolean {
  return resolveAuthMode(env) === 'demo';
}
