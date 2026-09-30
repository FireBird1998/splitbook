import type { MobileConfig } from './data/types';
import type { ExpoConfig } from 'expo/config';
import { parseWebOrigin } from './web-origin';

type InvitationEnvironment = { mode?: string; authOrigin?: string; inviteOrigin?: string };

/** Build-time registration; incoming links still pass the stricter runtime parser. */
export function androidInvitationFilters(
  env: InvitationEnvironment,
): NonNullable<NonNullable<ExpoConfig['android']>['intentFilters']> {
  if (env.mode !== 'development' && env.mode !== 'staging') return [];
  const origin = parseWebOrigin(env.inviteOrigin ?? env.authOrigin ?? '');
  if (!origin || (env.mode === 'staging' && origin.protocol !== 'https:')) return [];
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
}

/** Malformed/missing build settings must show setup UI, never crash or enable demo. */
export function developmentConfig(
  env: { mode?: string; apiUrl?: string; authOrigin?: string; inviteOrigin?: string },
  developmentBuild: boolean,
): MobileConfig | null {
  if (!developmentBuild || env.mode !== 'development' || !env.apiUrl || !env.authOrigin)
    return null;
  for (const value of [env.apiUrl, env.authOrigin, env.inviteOrigin ?? env.authOrigin]) {
    if (!parseWebOrigin(value)) return null;
  }
  return {
    apiBaseUrl: env.apiUrl,
    authOrigin: env.authOrigin,
    inviteOrigin: env.inviteOrigin ?? env.authOrigin,
    developmentPersonaEnabled: true,
  };
}

/** Staging is a real-account environment; it never enables development personas. */
export function mobileConfig(
  env: {
    mode?: string;
    apiUrl?: string;
    authOrigin?: string;
    inviteOrigin?: string;
    googleWebClientId?: string;
  },
  developmentBuild: boolean,
): MobileConfig | null {
  if (env.mode === 'development') return developmentConfig(env, developmentBuild);
  if (env.mode !== 'staging') return null;
  const api = parseWebOrigin(env.apiUrl ?? '');
  const auth = parseWebOrigin(env.authOrigin ?? '');
  const invite = parseWebOrigin(env.inviteOrigin ?? env.authOrigin ?? '');
  if (
    !api ||
    !auth ||
    !invite ||
    [api, auth, invite].some((url) => url.protocol !== 'https:') ||
    api.origin !== auth.origin ||
    !/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(env.googleWebClientId ?? '')
  )
    return null;
  return {
    apiBaseUrl: api.origin,
    authOrigin: auth.origin,
    inviteOrigin: invite.origin,
    developmentPersonaEnabled: false,
    googleWebClientId: env.googleWebClientId,
  };
}
