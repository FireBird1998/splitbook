import type { MobileConfig } from './data/types';
import type { ExpoConfig } from 'expo/config';
import { parseWebOrigin } from './web-origin';

/** Expo replaces these named settings in app and headless bundles alike. No runtime starts here. */
export const mobileBuildSettings = {
  mode: process.env.EXPO_PUBLIC_APP_ENV,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  authOrigin: process.env.EXPO_PUBLIC_AUTH_ORIGIN,
  inviteOrigin: process.env.EXPO_PUBLIC_INVITE_ORIGIN,
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};

/** Same reading as the app; an invalid build retains the renderer's raw fallback key. */
export function widgetKey(
  env: Parameters<typeof mobileConfig>[0],
  developmentBuild: boolean,
): string {
  return mobileConfig(env, developmentBuild)?.apiBaseUrl ?? env.apiUrl ?? '';
}

type InvitationEnvironment = {
  mode?: string;
  authOrigin?: string;
  inviteOrigin?: string;
  reviewEnabled?: boolean;
};

/** Build-time registration; incoming links still pass the stricter runtime parser. */
export function androidInvitationFilters(
  env: InvitationEnvironment,
): NonNullable<NonNullable<ExpoConfig['android']>['intentFilters']> {
  if (!['development', 'staging', 'production'].includes(env.mode ?? '')) return [];
  const origin = parseWebOrigin(env.inviteOrigin ?? env.authOrigin ?? '');
  if (!origin || (env.mode !== 'development' && origin.protocol !== 'https:')) return [];
  return [
    {
      action: 'VIEW',
      autoVerify: env.mode !== 'development',
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

    ...(env.reviewEnabled
      ? [
          {
            action: 'VIEW',
            autoVerify: env.mode !== 'development',
            data: [
              {
                scheme: origin.protocol.slice(0, -1),
                host: origin.hostname,
                ...(origin.port ? { port: origin.port } : {}),
                pathPattern: '/groups/.*/review',
              },
            ],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : []),
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
  if (env.mode !== 'staging' && env.mode !== 'production') return null;
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
    googleEnvironment: env.mode,
    googleWebClientId: env.googleWebClientId,
  };
}

/** Off by default, including when viewing a Saved copy from an earlier enabled build. */
export function headerScenesEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HEADER_SCENES_ENABLED === 'true';
}

/**
 * Whether Header scenes may move on this build. On since the scene is drawn from pictures moved by
 * native transforms (ADR 0012); set false to ship still scenes without the phone's Motion and Tilt
 * card.
 */
export const headerSceneMotionAvailable = true;
