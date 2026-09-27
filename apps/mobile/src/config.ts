import type { MobileConfig } from './data/types';

/** Malformed/missing build settings must show setup UI, never crash or enable demo. */
export function developmentConfig(
  env: { mode?: string; apiUrl?: string; authOrigin?: string },
  developmentBuild: boolean,
): MobileConfig | null {
  if (!developmentBuild || env.mode !== 'development' || !env.apiUrl || !env.authOrigin)
    return null;
  try {
    for (const value of [env.apiUrl, env.authOrigin]) {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        return null;
    }
    return { apiBaseUrl: env.apiUrl, authOrigin: env.authOrigin, developmentPersonaEnabled: true };
  } catch {
    return null;
  }
}
