/**
 * Builds the Splitbook Better Auth instance. `src/lib/auth.ts` calls this with
 * the MongoDB adapter; tests call it with the memory adapter, so every option
 * below is exercised without a database.
 *
 * Decisions (docs/superpowers/specs/2026-09-08-better-auth-migration.md):
 * database sessions with a five-minute cookie cache, 30-day sessions
 * refreshed after a day of use, rate limiting stored in the database,
 * Google as the only provider behind the `AUTH_ALLOWED_EMAILS` gate, the demo
 * persona plugin only when demo auth is allowed, `nextCookies()` last.
 */

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { validateAllowedUser } from '@/lib/auth/allowlist';
import { demoPersonaPluginIfAllowed } from '@/lib/auth/demo-persona-plugin';
import { isTestIdTokenOverrideEnabled, verifyTestIdToken } from '@/lib/auth/test-id-token';
import type { AuthModeEnv } from '@/lib/auth-mode';

export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
export const SESSION_COOKIE_CACHE_MAX_AGE_SECONDS = 5 * 60;

export interface AuthEnv extends AuthModeEnv {
  NEXT_PUBLIC_APP_URL?: string | undefined;
  AUTH_SECRET?: string | undefined;
  AUTH_GOOGLE_ID?: string | undefined;
  AUTH_GOOGLE_SECRET?: string | undefined;
  AUTH_ALLOWED_EMAILS?: string | undefined;
  AUTH_TEST_ID_TOKEN_SECRET?: string | undefined;
  ALLOW_TEST_ID_TOKEN?: string | undefined;
  /**
   * Optional override of Better Auth's default (rate limiting on in
   * production only). The browser suites run a production build on one
   * loopback address, where every request shares one bucket, and set it to
   * `false`.
   */
  AUTH_RATE_LIMIT_ENABLED?: string | undefined;
  [key: string]: string | undefined;
}

export interface CreateAuthInput {
  database: BetterAuthOptions['database'];
  env?: AuthEnv;
}

function rateLimitEnabled(env: AuthEnv): boolean | undefined {
  if (env.AUTH_RATE_LIMIT_ENABLED === 'true') return true;
  if (env.AUTH_RATE_LIMIT_ENABLED === 'false') return false;
  return undefined;
}

export function buildAuthOptions({ database, env = process.env }: CreateAuthInput) {
  const appUrl = env.NEXT_PUBLIC_APP_URL || undefined;
  const testIdTokenSecret = isTestIdTokenOverrideEnabled(env)
    ? env.AUTH_TEST_ID_TOKEN_SECRET
    : undefined;
  const demoPlugin = demoPersonaPluginIfAllowed(env);

  return {
    appName: 'Splitbook',
    baseURL: appUrl,
    secret: env.AUTH_SECRET || undefined,
    database,
    trustedOrigins: appUrl ? [appUrl] : [],
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_COOKIE_CACHE_MAX_AGE_SECONDS,
      },
    },
    rateLimit: {
      enabled: rateLimitEnabled(env),
      storage: 'database',
    },
    account: {
      accountLinking: {
        enabled: true,
        // Google reports verified emails, so a Google login links to the
        // existing user with that email (how migrated users get their new
        // account row on the first sign-in after cutover).
        trustedProviders: ['google'],
      },
    },
    socialProviders: {
      google: {
        clientId: env.AUTH_GOOGLE_ID ?? '',
        clientSecret: env.AUTH_GOOGLE_SECRET ?? '',
        prompt: 'select_account',
        ...(testIdTokenSecret
          ? {
              verifyIdToken: async (token: string, nonce?: string) =>
                verifyTestIdToken(token, testIdTokenSecret, nonce),
            }
          : {}),
      },
    },
    user: {
      // The gate runs on user creation, account linking and every OAuth
      // sign-in, so allowlist removals take effect at the next Google login.
      validateUserInfo: (data) => validateAllowedUser(data, env),
      additionalFields: {
        preferredCurrency: {
          type: 'string',
          required: false,
          defaultValue: 'INR',
          input: false,
        },
      },
    },
    plugins: [...(demoPlugin ? [demoPlugin] : []), nextCookies()],
  } satisfies BetterAuthOptions;
}

export function createSplitbookAuth(input: CreateAuthInput) {
  return betterAuth(buildAuthOptions(input));
}

export type SplitbookAuth = ReturnType<typeof createSplitbookAuth>;
