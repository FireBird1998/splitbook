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

/** The receipt-scanning experiment exists only in development and staging builds. */
export function receiptScanEnabled(mode: string | undefined): boolean {
  return mode === 'development' || mode === 'staging';
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
