import type { MobileConfig } from './data/types';
import type { ExpoConfig } from 'expo/config';

type InvitationEnvironment = { mode?: string; authOrigin?: string; inviteOrigin?: string };

/** Build-time registration; incoming links still pass the stricter runtime parser. */
export function androidInvitationFilters(
  env: InvitationEnvironment,
): NonNullable<NonNullable<ExpoConfig['android']>['intentFilters']> {
  if (env.mode !== 'development' && env.mode !== 'staging') return [];
  try {
    const origin = new URL(env.inviteOrigin ?? env.authOrigin ?? '');
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      (env.mode === 'staging' && origin.protocol !== 'https:') ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/'
    )
      return [];
    return [
      {
        action: 'VIEW',
        autoVerify: env.mode === 'staging',
        data: [
          {
            scheme: origin.protocol.slice(0, -1),
            host: origin.hostname,
            ...(origin.port ? { port: origin.port } : {}),
            pathPrefix: '/join/',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ];
  } catch {
    return [];
  }
}

/** Malformed/missing build settings must show setup UI, never crash or enable demo. */
export function developmentConfig(
  env: { mode?: string; apiUrl?: string; authOrigin?: string; inviteOrigin?: string },
  developmentBuild: boolean,
): MobileConfig | null {
  if (!developmentBuild || env.mode !== 'development' || !env.apiUrl || !env.authOrigin)
    return null;
  try {
    for (const value of [env.apiUrl, env.authOrigin, env.inviteOrigin ?? env.authOrigin]) {
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
    return {
      apiBaseUrl: env.apiUrl,
      authOrigin: env.authOrigin,
      inviteOrigin: env.inviteOrigin ?? env.authOrigin,
      developmentPersonaEnabled: true,
    };
  } catch {
    return null;
  }
}
